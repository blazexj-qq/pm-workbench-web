# -*- coding: utf-8 -*-
"""
AI 代理（阿里云函数计算 HTTP 函数）· 项目管理工作台「方案 A / 云端代理」专用
============================================================================
作用：作为浏览器（通用项目管理工作台.html）与大模型之间的「云端管家」，
      解决两件事：① 浏览器直连大模型被跨域(CORS)拦截；② Key 放前端不安全。

      网页只把 {model, messages} 发到本函数的 /chat 接口，
      由函数拿着服务端环境变量里的 Key 去调大模型，Key 不落前端。

接口（与工作台 callAI 契约 100% 一致，可直接复用）：
  POST /chat
  body:   { "model": "qwen-plus", "messages": [...], "temperature": 0.3 }
  返回：  大模型原始 JSON，含 choices[0].message.content（OpenAI 兼容格式）

环境变量（部署时填，不用改代码）：
  API_KEY          大模型 API Key（通义千问 / DeepSeek 等）
  API_BASE         模型接口基地址；通义千问填 https://dashscope.aliyuncs.com/compatible-mode/v1
                   DeepSeek 填 https://api.deepseek.com/v1
  API_MODEL        默认模型名（前端传 model 则覆盖），默认 qwen-plus
  ALLOWED_ORIGIN   允许调用的网页域名；本地双击 html 打开留空(=*) 即可

依赖：requests （阿里云 FC Python 3.12 运行时已自带）
"""

import json
import os

import requests

# ========== 配置（全部从环境变量读取，部署时不用改代码） ==========
API_KEY        = os.getenv("API_KEY")
API_BASE       = (os.getenv("API_BASE") or "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/")
API_MODEL      = os.getenv("API_MODEL", "qwen-plus")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "*")


# ========== CORS 头（允许网页跨域调用） ==========
def cors_headers():
    return [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Access-Control-Allow-Origin", ALLOWED_ORIGIN),
        ("Access-Control-Allow-Methods", "POST,OPTIONS"),
        ("Access-Control-Allow-Headers", "Content-Type"),
    ]


# ========== HTTP 触发器入口（WSGI 风格，与 feishu_sync.py 同款） ==========
def handler(environ, start_response):
    method = environ.get("REQUEST_METHOD", "GET")
    path = environ.get("PATH_INFO", "/")

    # 预检请求直接放行
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
        return [json.dumps({"error": "invalid json"}, ensure_ascii=False).encode("utf-8")]

    # 只接受 /chat 接口
    if path.rstrip("/") not in ("/chat",):
        start_response("404 Not Found", cors_headers())
        return [json.dumps({"error": "not found, use POST /chat"}, ensure_ascii=False).encode("utf-8")]

    if not API_KEY:
        start_response("500 Internal Server Error", cors_headers())
        return [json.dumps({"error": "missing API_KEY env"}, ensure_ascii=False).encode("utf-8")]

    # 组装转发给大模型
    model = payload.get("model") or API_MODEL
    messages = payload.get("messages", [])
    temperature = payload.get("temperature", 0.3)
    try:
        upstream = requests.post(
            API_BASE + "/chat/completions",
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + API_KEY},
            json={"model": model, "messages": messages, "temperature": temperature},
            timeout=60,
        )
        # 把大模型原始响应原样透传（含 choices[0].message.content），前端直接 json() 取用
        body = upstream.text
        status = str(upstream.status_code) + " " + (upstream.reason or "")
        start_response(status, cors_headers())
        return [body.encode("utf-8")]
    except Exception as e:
        start_response("500 Internal Server Error", cors_headers())
        return [json.dumps({"error": str(e)}, ensure_ascii=False).encode("utf-8")]
