# -*- coding: utf-8 -*-
"""
飞书同步代理（阿里云函数计算 HTTP 函数）· 项目管理工作台「飞书同步」专用
============================================================================
作用：作为浏览器（通用项目管理工作台.html）与飞书多维表格之间的「云端桥梁」，
      解决两件事：
        ① 浏览器直连飞书 API 被跨域(CORS)拦截（飞书 API 不允许任意网页直接调）；
        ② 飞书 App Secret 不能放前端（会泄露给任何打开网页的人）。

      网页只发「空 body / record_id」到本函数的 /feishu-sync、/feishu-review 接口，
      由函数拿着服务端环境变量里的 App ID/Secret 去调飞书，Secret 不落前端。

接口（与工作台 feishuSync / feishuReview 契约 100% 一致，可直接部署）：
  POST /feishu-sync
    body:   { "since": "2026-08-01T00:00:00.000Z" }   // 上次同步时间，可空；当前拉全部、由前端去重
    返回：  { "records": [ { "record_id": "...", "fields": { ... } }, ... ] }
            —— 飞书原始记录原样透传，字段映射由前端 mapFeishuToTask 负责（不要改这里的结构）。

  POST /feishu-review
    body:   { "record_id": "xxx" }
    作用：  把飞书【工作台账】那条记录的「复核状态」字段改为「已复核」（关掉扣子的防错闸）
    返回：  HTTP 200 即成功（前端只看 resp.ok，不解析 body）

环境变量（部署时填，不用改代码）：
  FEISHU_APP_ID        飞书自建应用 App ID
  FEISHU_APP_SECRET    飞书自建应用 App Secret（敏感，只在阿里云控制台填，别粘进聊天）
  BITABLE_APP_TOKEN    飞书多维表格 app token（默认已填 ZWWebEluhaJSGBsmg95czkEzn0e，一般不用改）
  BITABLE_TABLE_ID     工作台账表 ID（默认已填 tblHmMEnDJDrra0p，一般不用改）
  ALLOWED_ORIGIN       允许调用的网页域名；本地双击 html 打开留空(=*) 即可；只上线 GitHub Pages 可填域名防刷

依赖：requests （阿里云 FC Python 3.12 运行时已自带，无需 pip install）
函数入口（阿里云控制台填）：feishu_sync.handler
"""

import json
import os
import time

import requests

# ========== 配置（全部从环境变量读取，部署时不用改代码） ==========
APP_ID          = os.getenv("FEISHU_APP_ID")
APP_SECRET      = os.getenv("FEISHU_APP_SECRET")
APP_TOKEN       = os.getenv("BITABLE_APP_TOKEN", "ZWWebEluhaJSGBsmg95czkEzn0e")
TABLE_ID        = os.getenv("BITABLE_TABLE_ID", "tblHmMEnDJDrra0p")
ALLOWED_ORIGIN  = os.getenv("ALLOWED_ORIGIN", "*")

FEISHU_BASE     = "https://open.feishu.cn/open-apis"
# 模块级缓存 token（FC 实例可能复用，减少换票调用；过期前 30 秒自动重换）
_token = {"value": None, "exp": 0}


# ========== CORS 头（允许网页跨域调用） ==========
def cors_headers():
    return [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Access-Control-Allow-Origin", ALLOWED_ORIGIN),
        ("Access-Control-Allow-Methods", "POST,OPTIONS"),
        ("Access-Control-Allow-Headers", "Content-Type"),
    ]


def _json(body, status="200 OK"):
    """把 dict 变成 WSGI 需要的字节列表。"""
    return [json.dumps(body, ensure_ascii=False).encode("utf-8")]


def get_token():
    """获取 tenant_access_token（带简单缓存，有效期内复用）。"""
    now = time.time()
    if _token["value"] and now < _token["exp"] - 30:
        return _token["value"], None
    if not APP_ID or not APP_SECRET:
        return None, "missing FEISHU_APP_ID / FEISHU_APP_SECRET env"
    try:
        r = requests.post(
            FEISHU_BASE + "/auth/v3/tenant_access_token/internal",
            json={"app_id": APP_ID, "app_secret": APP_SECRET},
            timeout=10,
        )
        data = r.json()
    except Exception as e:
        return None, "获取 token 网络错误: " + str(e)
    if data.get("code") != 0:
        return None, "tenant_access_token 错误: " + str(data.get("msg"))
    _token["value"] = data.get("tenant_access_token")
    _token["exp"] = now + float(data.get("expire", 7200))
    return _token["value"], None


def list_records(token):
    """分页拉取工作台账全部记录，返回飞书原始 items 列表（前端负责映射）。"""
    items = []
    page_token = None
    while True:
        params = {"page_size": 500}  # 飞书单页上限 500
        if page_token:
            params["page_token"] = page_token
        r = requests.get(
            FEISHU_BASE + "/bitable/v1/apps/%s/tables/%s/records" % (APP_TOKEN, TABLE_ID),
            headers={"Authorization": "Bearer " + token},
            params=params,
            timeout=15,
        )
        data = r.json()
        if data.get("code") != 0:
            raise RuntimeError("拉取记录失败: " + str(data.get("msg")))
        items.extend(data.get("data", {}).get("items", []))
        if not data.get("data", {}).get("has_more"):
            break
        page_token = data.get("data", {}).get("page_token")
        if not page_token:
            break
    return items


def review_record(token, record_id):
    """把某条记录的「复核状态」改为「已复核」。"""
    r = requests.put(
        FEISHU_BASE + "/bitable/v1/apps/%s/tables/%s/records/%s" % (APP_TOKEN, TABLE_ID, record_id),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        json={"fields": {"复核状态": "已复核"}},
        timeout=15,
    )
    data = r.json()
    if data.get("code") != 0:
        raise RuntimeError("回写复核失败: " + str(data.get("msg")))
    return True


# ========== HTTP 触发器入口（WSGI 风格，与 ai-proxy-fc.py 同款） ==========
def handler(environ, start_response):
    method = environ.get("REQUEST_METHOD", "GET")
    path = environ.get("PATH_INFO", "/")

    # 预检请求（OPTIONS）直接放行，否则浏览器跨域调不通
    if method == "OPTIONS":
        start_response("204 No Content", cors_headers())
        return [b""]

    # 解析请求体
    try:
        length = int(environ.get("CONTENT_LENGTH", 0) or 0)
    except ValueError:
        length = 0
    raw = environ["wsgi.input"].read(length) if length else b""
    try:
        payload = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:
        start_response("400 Bad Request", cors_headers())
        return _json({"error": "invalid json"})

    # 只接受这两个接口
    route = path.rstrip("/")
    if route not in ("/feishu-sync", "/feishu-review"):
        start_response("404 Not Found", cors_headers())
        return _json({"error": "not found, use POST /feishu-sync or /feishu-review"})

    # 先换飞书 token（两个接口都要）
    token, err = get_token()
    if err:
        start_response("500 Internal Server Error", cors_headers())
        return _json({"error": err})

    try:
        if route == "/feishu-sync":
            # since 参数当前保留但不强制服务端过滤（前端已做去重）；
            # 数据量大时未来可加飞书 filter 公式按日期筛，这里先全量返回。
            items = list_records(token)
            start_response("200 OK", cors_headers())
            return _json({"records": items})
        else:  # /feishu-review
            rid = payload.get("record_id")
            if not rid:
                start_response("400 Bad Request", cors_headers())
                return _json({"error": "missing record_id"})
            review_record(token, rid)
            start_response("200 OK", cors_headers())
            return _json({"ok": True})
    except Exception as e:
        start_response("500 Internal Server Error", cors_headers())
        return _json({"error": str(e)})
