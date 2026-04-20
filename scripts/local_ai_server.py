#!/usr/bin/env python3
import argparse
import base64
import hmac
import ipaddress
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5000
DEFAULT_MODEL = "local-stub-chat"
DEFAULT_BACKEND = "stub"
DEFAULT_MAX_REQUEST_BYTES = 64 * 1024 * 1024
AUTH_TOKEN_ENV = "IDENAAI_LOCAL_RUNTIME_TOKEN"


class RequestTooLargeError(Exception):
    pass


class AuthenticationError(Exception):
    pass


class UnsupportedMediaTypeError(Exception):
    pass


def is_loopback_host(value):
    host = str(value or "").strip().strip("[]")
    if not host:
        return False
    if host.lower() == "localhost":
        return True

    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def build_json_response(handler, status_code, payload, extra_headers=None):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status_code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    for header_name, header_value in (extra_headers or {}).items():
        handler.send_header(str(header_name), str(header_value))
    handler.end_headers()
    handler.wfile.write(body)


def is_json_content_type(value):
    media_type = str(value or "").split(";", 1)[0].strip().lower()
    return media_type == "application/json" or media_type.endswith("+json")


def extract_auth_token(headers):
    direct = str(headers.get("X-IdenaAI-Local-Token") or "").strip()
    if direct:
        return direct

    authorization = str(headers.get("Authorization") or "").strip()
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()

    return ""


def extract_text_content(content):
    if isinstance(content, str):
        return content.strip()

    if not isinstance(content, list):
        return ""

    parts = []
    for item in content:
        if isinstance(item, str):
            text = item.strip()
            if text:
                parts.append(text)
            continue

        if not isinstance(item, dict):
            continue

        item_type = str(item.get("type") or "").strip().lower()
        if item_type not in ("text", "input_text"):
            continue

        text = str(item.get("text") or "").strip()
        if text:
            parts.append(text)

    return "\n".join(parts).strip()


def load_image_source(value, *, allow_local_image_paths=False):
    from PIL import Image

    image_value = value
    if isinstance(value, dict):
        image_value = value.get("url") or value.get("image_url") or value.get("image")

    image_text = str(image_value or "").strip()
    if not image_text:
        raise ValueError("image_source_required")

    if image_text.startswith("data:image/"):
        _, encoded = image_text.split(",", 1)
        raw = base64.b64decode(encoded, validate=True)
        image = Image.open(BytesIO(raw))
        image.load()
        return image.convert("RGB")

    if allow_local_image_paths and os.path.exists(image_text):
        image = Image.open(image_text)
        image.load()
        return image.convert("RGB")

    raise ValueError("unsupported_image_source")


def normalize_openai_messages(messages, *, allow_local_image_paths=False):
    normalized = []

    for item in messages or []:
        if not isinstance(item, dict):
            continue

        role = str(item.get("role") or "user").strip() or "user"
        content = item.get("content")

        if isinstance(content, str):
            text = content.strip()
            if text:
                normalized.append(
                    {
                        "role": role,
                        "content": [{"type": "text", "text": text}],
                    }
                )
            continue

        if not isinstance(content, list):
            continue

        parts = []
        for part in content:
            if isinstance(part, str):
                text = part.strip()
                if text:
                    parts.append({"type": "text", "text": text})
                continue

            if not isinstance(part, dict):
                continue

            part_type = str(part.get("type") or "").strip().lower()

            if part_type in ("text", "input_text"):
                text = str(part.get("text") or "").strip()
                if text:
                    parts.append({"type": "text", "text": text})
                continue

            if part_type in ("image", "image_url", "input_image"):
                image_value = (
                    part.get("image")
                    or part.get("image_url")
                    or part.get("input_image")
                )
                image = load_image_source(
                    image_value,
                    allow_local_image_paths=allow_local_image_paths,
                )
                parts.append({"type": "image", "image": image})

        if parts:
            normalized.append({"role": role, "content": parts})

    return normalized


def extract_images_from_messages(messages):
    images = []

    for message in messages or []:
        for part in message.get("content") or []:
            if part.get("type") == "image" and part.get("image") is not None:
                images.append(part.get("image"))

    return images


def read_config_value(source, *keys):
    current = source
    for key in keys:
        if isinstance(current, dict):
            current = current.get(key)
        else:
            current = getattr(current, key, None)
        if current is None:
            return None
    return current


def resolve_image_token_index(config):
    candidates = [
        read_config_value(config, "image_token_index"),
        read_config_value(config, "image_token_id"),
        read_config_value(config, "text_config", "image_token_index"),
        read_config_value(config, "text_config", "image_token_id"),
        read_config_value(config, "vision_config", "image_token_index"),
        read_config_value(config, "vision_config", "image_token_id"),
    ]

    for candidate in candidates:
        if isinstance(candidate, int):
            return candidate
        if isinstance(candidate, float) and float(candidate).is_integer():
            return int(candidate)

    raise KeyError(
        "Model config is missing image_token_index/image_token_id; "
        "cannot prepare runtime inputs for this base model"
    )


def resolve_model_source(model_id, revision=None):
    resolved_model_id = str(model_id or "").strip()
    resolved_revision = str(revision or "").strip()

    if not resolved_model_id:
        raise ValueError("model_id_required")

    if os.path.isdir(resolved_model_id) or not resolved_revision:
        return resolved_model_id

    from huggingface_hub import snapshot_download

    return snapshot_download(
        repo_id=resolved_model_id,
        revision=resolved_revision,
    )


class StubBackend:
    name = "stub"

    def __init__(self, model_id):
        self.model_id = str(model_id or DEFAULT_MODEL).strip() or DEFAULT_MODEL

    def health(self):
        return {
            "status": "ok",
            "ok": True,
            "service": "local-ai-sidecar-stub",
            "backend": self.name,
            "loaded_model": self.model_id,
            "generatedAt": int(time.time()),
        }

    def models(self):
        return [
            {
                "id": self.model_id,
                "object": "model",
                "owned_by": "local-sidecar-stub",
            }
        ]

    def chat(self, payload):
        model = str(payload.get("model") or self.model_id).strip() or self.model_id
        return {
            "id": "chatcmpl-local-stub",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": "Local AI sidecar stub is reachable. Real local inference is not implemented yet.",
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            },
        }


class TransformersChatBackend:
    name = "transformers"

    def __init__(
        self,
        model_id,
        trust_remote_code=False,
        model_revision="",
        allow_local_image_paths=False,
    ):
        from transformers import AutoModelForImageTextToText, AutoProcessor
        import torch

        self.model_id = str(model_id or "").strip()
        if not self.model_id:
            raise ValueError("model_id_required")
        self.model_revision = str(model_revision or "").strip()
        self.allow_local_image_paths = allow_local_image_paths
        self.model_source = resolve_model_source(self.model_id, self.model_revision)

        self.torch = torch
        self.processor = AutoProcessor.from_pretrained(
            self.model_source,
            trust_remote_code=trust_remote_code,
            padding_side="left",
        )
        self.model = AutoModelForImageTextToText.from_pretrained(
            self.model_source,
            trust_remote_code=trust_remote_code,
            dtype="auto",
            device_map="auto",
        )

    def health(self):
        return {
            "status": "ok",
            "ok": True,
            "service": "local-ai-sidecar",
            "backend": self.name,
            "loaded_model": self.model_id,
            "loaded_revision": self.model_revision or None,
            "generatedAt": int(time.time()),
        }

    def models(self):
        return [
            {
                "id": self.model_id,
                "object": "model",
                "owned_by": "local-sidecar-transformers",
            }
        ]

    def _generation_kwargs(self, payload):
        max_tokens = int(payload.get("max_tokens") or 768)
        max_tokens = max(1, min(max_tokens, 2048))
        temperature = payload.get("temperature")
        kwargs = {
            "max_new_tokens": max_tokens,
        }

        try:
            temperature = float(temperature)
        except (TypeError, ValueError):
            temperature = None

        if temperature is not None and temperature > 0:
            kwargs["do_sample"] = True
            kwargs["temperature"] = max(0.01, min(temperature, 2.0))
        else:
            kwargs["do_sample"] = False

        return kwargs

    def chat(self, payload):
        requested_model = str(payload.get("model") or self.model_id).strip() or self.model_id
        if requested_model != self.model_id:
            raise ValueError("requested_model_not_loaded")

        messages = normalize_openai_messages(
            payload.get("messages") or [],
            allow_local_image_paths=self.allow_local_image_paths,
        )
        if not messages:
            raise ValueError("messages_required")

        inputs = self.processor.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
            return_dict=True,
            padding=True,
        )
        inputs = {
            key: value.to(self.model.device) if hasattr(value, "to") else value
            for key, value in inputs.items()
        }

        generation_kwargs = self._generation_kwargs(payload)

        with self.torch.inference_mode():
            generated_ids = self.model.generate(**inputs, **generation_kwargs)

        prompt_tokens = int(inputs["input_ids"].shape[-1])
        generated_tokens = generated_ids[0, prompt_tokens:]
        generated_text = self.processor.tokenizer.decode(
            generated_tokens, skip_special_tokens=True
        ).strip()

        if not generated_text:
            raise ValueError("empty_generation")

        completion_tokens = int(generated_tokens.shape[-1])

        return {
            "id": f"chatcmpl-local-{int(time.time())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": self.model_id,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": generated_text,
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
        }


class MlxVlmChatBackend:
    name = "mlx-vlm"

    def __init__(
        self,
        model_id,
        trust_remote_code=False,
        model_revision="",
        allow_local_image_paths=False,
    ):
        try:
            from mlx_vlm.utils import generate, load, prepare_inputs
        except ImportError:
            from mlx_vlm.generate import generate
            from mlx_vlm.utils import load, prepare_inputs

        self.model_id = str(model_id or "").strip()
        if not self.model_id:
            raise ValueError("model_id_required")

        self.model_revision = str(model_revision or "").strip()
        self.allow_local_image_paths = allow_local_image_paths
        self.generate = generate
        self.prepare_inputs = prepare_inputs
        self.model_source = resolve_model_source(self.model_id, self.model_revision)
        load_kwargs = {
            "trust_remote_code": trust_remote_code,
            "use_fast": False,
        }

        try:
            self.model, self.processor = load(self.model_source, **load_kwargs)
        except TypeError as error:
            if "multiple values for keyword argument 'use_fast'" not in str(error):
                raise
            self.model, self.processor = load(
                self.model_source,
                trust_remote_code=trust_remote_code,
            )

    def health(self):
        return {
            "status": "ok",
            "ok": True,
            "service": "local-ai-sidecar",
            "backend": self.name,
            "loaded_model": self.model_id,
            "loaded_revision": self.model_revision or None,
            "generatedAt": int(time.time()),
        }

    def models(self):
        return [
            {
                "id": self.model_id,
                "object": "model",
                "owned_by": "local-sidecar-mlx-vlm",
            }
        ]

    def _generation_kwargs(self, payload):
        max_tokens = int(payload.get("max_tokens") or 768)
        max_tokens = max(1, min(max_tokens, 2048))
        temperature = payload.get("temperature")

        try:
            temperature = float(temperature)
        except (TypeError, ValueError):
            temperature = 0.0

        return {
            "max_tokens": max_tokens,
            "temperature": max(0.0, min(temperature, 2.0)),
            "verbose": False,
        }

    def chat(self, payload):
        requested_model = str(payload.get("model") or self.model_id).strip() or self.model_id
        if requested_model != self.model_id:
            raise ValueError("requested_model_not_loaded")

        messages = normalize_openai_messages(
            payload.get("messages") or [],
            allow_local_image_paths=self.allow_local_image_paths,
        )
        if not messages:
            raise ValueError("messages_required")

        images = extract_images_from_messages(messages)
        prompt = self.processor.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
        prepared = self.prepare_inputs(
            processor=self.processor,
            images=images,
            prompts=[prompt],
            image_token_index=resolve_image_token_index(self.model.config),
        )
        generation_kwargs = self._generation_kwargs(payload)
        response = self.generate(
            self.model,
            self.processor,
            prompt,
            pixel_values=prepared["pixel_values"],
            input_ids=prepared["input_ids"],
            mask=prepared["attention_mask"],
            **generation_kwargs,
            **{
                key: value
                for key, value in prepared.items()
                if key not in {"pixel_values", "input_ids", "attention_mask"}
            },
        )
        generated_text = str(response or "").strip()

        if not generated_text:
            raise ValueError("empty_generation")

        prompt_tokens = int(prepared["input_ids"].shape[-1])
        completion_tokens = 0

        try:
            completion_tokens = len(
                self.processor.tokenizer.encode(
                    generated_text,
                    add_special_tokens=False,
                )
            )
        except Exception:
            completion_tokens = 0

        return {
            "id": f"chatcmpl-local-{int(time.time())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": self.model_id,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": generated_text,
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
            },
        }


def create_backend(args):
    if args.backend == "stub":
        return StubBackend(args.model)

    if args.backend == "mlx-vlm":
        return MlxVlmChatBackend(
            args.model,
            trust_remote_code=args.trust_remote_code,
            model_revision=args.model_revision,
            allow_local_image_paths=args.allow_local_image_paths,
        )

    if args.backend == "transformers":
        return TransformersChatBackend(
            args.model,
            trust_remote_code=args.trust_remote_code,
            model_revision=args.model_revision,
            allow_local_image_paths=args.allow_local_image_paths,
        )

    raise ValueError(f"Unsupported backend: {args.backend}")


class LocalAiHandler(BaseHTTPRequestHandler):
    server_version = "IdenaLocalAIServer/0.2"

    def log_message(self, _format, *_args):
        return

    def _check_auth(self):
        expected = str(getattr(self.server, "auth_token", "") or "").strip()
        if not expected:
            return

        provided = extract_auth_token(self.headers)
        if not provided or not hmac.compare_digest(provided, expected):
            raise AuthenticationError("invalid_auth_token")

    def _read_json(self):
        if not is_json_content_type(self.headers.get("Content-Type")):
            raise UnsupportedMediaTypeError("json_content_type_required")

        max_request_bytes = getattr(
            self.server, "max_request_bytes", DEFAULT_MAX_REQUEST_BYTES
        )
        raw_length = str(self.headers.get("Content-Length", "0") or "0").strip()
        length = int(raw_length or "0")

        if length < 0:
            raise ValueError("invalid_content_length")
        if length > max_request_bytes:
            raise RequestTooLargeError(length)
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw) if raw else {}

    def do_GET(self):
        backend = self.server.backend

        try:
            self._check_auth()
        except AuthenticationError:
            build_json_response(
                self,
                401,
                {"error": {"message": "unauthorized", "type": "auth_error"}},
                extra_headers={"WWW-Authenticate": "Bearer"},
            )
            return

        if self.path in ("/health", "/health/"):
            build_json_response(self, 200, backend.health())
            return

        if self.path in ("/models", "/models/", "/v1/models", "/v1/models/"):
            build_json_response(
                self,
                200,
                {
                    "object": "list",
                    "data": backend.models(),
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
            self._check_auth()
            payload = self._read_json()
        except AuthenticationError:
            build_json_response(
                self,
                401,
                {"error": {"message": "unauthorized", "type": "auth_error"}},
                extra_headers={"WWW-Authenticate": "Bearer"},
            )
            return
        except UnsupportedMediaTypeError:
            build_json_response(
                self,
                415,
                {
                    "error": {
                        "message": "unsupported_media_type",
                        "type": "invalid_request",
                        "detail": "Local AI runtime requests must use application/json.",
                    }
                },
            )
            return
        except RequestTooLargeError:
            build_json_response(
                self,
                413,
                {
                    "error": {
                        "message": "request_too_large",
                        "type": "invalid_request",
                        "detail": f"Request body exceeds {self.server.max_request_bytes} bytes.",
                    }
                },
            )
            return
        except (UnicodeDecodeError, ValueError, json.JSONDecodeError):
            build_json_response(
                self,
                400,
                {"error": {"message": "invalid_json", "type": "invalid_request"}},
            )
            return

        if self.path in ("/v1/chat/completions", "/chat/completions"):
            try:
                response = self.server.backend.chat(payload)
            except ValueError as error:
                detail = str(error or "").strip() or "invalid_request"
                build_json_response(
                    self,
                    400,
                    {
                        "error": {
                            "message": detail,
                            "type": "invalid_request",
                        }
                    },
                )
                return
            except Exception as error:  # pragma: no cover - exercised in live runtime
                detail = str(error or "").strip() or "runtime_error"
                build_json_response(
                    self,
                    500,
                    {
                        "error": {
                            "message": "runtime_error",
                            "type": "server_error",
                            "detail": detail,
                        }
                    },
                )
                return

            build_json_response(self, 200, response)
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
                    "detail": f"{endpoint} is not implemented in this Local AI server yet.",
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
        description="Run the Local AI sidecar server for health, model listing, and chat completions."
    )
    parser.add_argument(
        "--backend",
        default=DEFAULT_BACKEND,
        choices=("stub", "mlx-vlm", "transformers"),
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--model-revision", default="")
    parser.add_argument(
        "--max-request-bytes",
        type=int,
        default=DEFAULT_MAX_REQUEST_BYTES,
    )
    parser.add_argument("--auth-token", default="")
    parser.add_argument(
        "--trust-remote-code",
        action="store_true",
        help="Trust remote model code when loading Hugging Face models.",
    )
    parser.add_argument(
        "--allow-local-image-paths",
        action="store_true",
        help="Allow local filesystem image paths in multimodal requests.",
    )
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="Allow binding the server to a non-loopback host.",
    )
    args = parser.parse_args()

    if not args.allow_remote and not is_loopback_host(args.host):
        parser.error(
            "Refusing to bind the Local AI server to a non-loopback host without --allow-remote."
        )

    backend = create_backend(args)
    server = ThreadingHTTPServer((args.host, args.port), LocalAiHandler)
    server.backend = backend
    server.max_request_bytes = max(1024, int(args.max_request_bytes or DEFAULT_MAX_REQUEST_BYTES))
    server.auth_token = str(args.auth_token or os.environ.get(AUTH_TOKEN_ENV) or "").strip()

    print(
        f"Local AI server ({args.backend}) listening on http://{args.host}:{args.port} with model {args.model}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
