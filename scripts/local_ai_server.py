#!/usr/bin/env python3
import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5000
DEFAULT_MODEL = "local-stub-chat"


def build_json_response(handler, status_code, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status_code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class LocalAiHandler(BaseHTTPRequestHandler):
    server_version = "IdenaLocalAIStub/0.1"

    def log_message(self, _format, *_args):
        return

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw) if raw else {}

    def do_GET(self):
        if self.path in ("/health", "/health/"):
            build_json_response(
                self,
                200,
                {
                    "ok": True,
                    "service": "local-ai-sidecar-stub",
                    "generatedAt": int(time.time()),
                },
            )
            return

        if self.path in ("/models", "/models/", "/v1/models", "/v1/models/"):
            build_json_response(
                self,
                200,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": DEFAULT_MODEL,
                            "object": "model",
                            "owned_by": "local-sidecar-stub",
                        }
                    ],
                },
            )
            return

        build_json_response(
            self,
            404,
            {"error": {"message": "not_found", "type": "not_found"}},
        )

    def do_POST(self):
        try:
            payload = self._read_json()
        except json.JSONDecodeError:
            build_json_response(
                self,
                400,
                {"error": {"message": "invalid_json", "type": "invalid_request"}},
            )
            return

        if self.path in ("/v1/chat/completions", "/chat/completions"):
            model = str(payload.get("model") or DEFAULT_MODEL).strip() or DEFAULT_MODEL
            build_json_response(
                self,
                200,
                {
                    "id": "chatcmpl-local-stub",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [
                        {
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": "Local AI sidecar stub is reachable. Real local inference is not implemented yet."
                            },
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                    },
                },
            )
            return

        if self.path in ("/caption", "/ocr", "/train"):
            endpoint = self.path.strip("/") or "unknown"
            build_json_response(
                self,
                200,
                {
                    "ok": False,
                    "status": "not_implemented",
                    "endpoint": endpoint,
                    "detail": f"{endpoint} is not implemented in the Local AI stub yet.",
                },
            )
            return

        build_json_response(
            self,
            404,
            {"error": {"message": "not_found", "type": "not_found"}},
        )


def main():
    parser = argparse.ArgumentParser(
        description="Run the Local AI sidecar stub for health/models/chat checks."
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), LocalAiHandler)
    print(f"Local AI sidecar stub listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
