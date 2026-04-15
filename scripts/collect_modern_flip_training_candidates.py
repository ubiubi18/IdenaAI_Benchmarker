#!/usr/bin/env python3
"""
Collect modern FLIP training candidates using IdenaAI's internal ranking schema.

Source priority for modern epochs:
1. local capture/index data + local node RPC
2. public indexer fallback only when local ranking fields are missing

This script intentionally does not depend on external community scripts.
"""

from __future__ import annotations

import argparse
import json
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from flip_training_ranker import build_modern_signals, build_ranking_policy


DEFAULT_INDEXER_BASE_URL = "https://api.idena.io/api"
DEFAULT_INTERNAL_RPC_URL = "http://127.0.0.1:9119"


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def trim_text(value: Any) -> str:
    return str(value or "").strip()


def safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(value)
    except Exception:
        return default


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def write_json_atomic(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=path.parent, delete=False, encoding="utf-8"
    ) as tmp:
        json.dump(payload, tmp, indent=2, ensure_ascii=False)
        tmp.write("\n")
        temp_name = tmp.name
    Path(temp_name).replace(path)


def normalize_epoch(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(value)
    except Exception:
        return None


def normalize_capture(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None

    flip_hash = trim_text(item.get("flipHash") or item.get("hash"))
    if not flip_hash:
        return None

    consensus = item.get("consensus")
    normalized_consensus = None
    if isinstance(consensus, dict):
        normalized_consensus = {
            "finalAnswer": trim_text(
                consensus.get("finalAnswer")
                or consensus.get("finalAnswerAfterRemap")
            ).lower()
            or None,
            "reported": bool(consensus.get("reported")),
        }

    return {
        "flipHash": flip_hash,
        "epoch": normalize_epoch(item.get("epoch")),
        "sessionType": trim_text(item.get("sessionType")) or None,
        "panelCount": safe_int(item.get("panelCount")),
        "timestamp": safe_int(item.get("timestamp")),
        "capturedAt": trim_text(item.get("capturedAt")) or None,
        "consensus": normalized_consensus,
    }


def load_capture_index(path: Path, epoch: int) -> List[Dict[str, Any]]:
    payload = read_json(path, {})
    captures = payload.get("captures") if isinstance(payload, dict) else []
    normalized = [normalize_capture(item) for item in captures or []]
    return [
        item
        for item in normalized
        if item and item["epoch"] == epoch and item["flipHash"]
    ]


def load_settings(path: Path) -> Dict[str, Any]:
    payload = read_json(path, {})
    return payload if isinstance(payload, dict) else {}


def resolve_rpc_url(args: argparse.Namespace, settings: Dict[str, Any]) -> str:
    if trim_text(args.rpc_url):
        return trim_text(args.rpc_url)

    if settings.get("useExternalNode"):
        return trim_text(settings.get("url")) or DEFAULT_INDEXER_BASE_URL

    port = safe_int(settings.get("internalPort"), 9119)
    return f"http://127.0.0.1:{port}"


def resolve_rpc_key(args: argparse.Namespace, settings: Dict[str, Any], user_data_dir: Path) -> str:
    if trim_text(args.rpc_key):
        return trim_text(args.rpc_key)

    if settings.get("useExternalNode"):
        return trim_text(settings.get("externalApiKey"))

    if trim_text(settings.get("internalApiKey")):
        return trim_text(settings.get("internalApiKey"))

    api_key_path = user_data_dir / "node" / "datadir" / "api.key"
    if api_key_path.exists():
        return trim_text(api_key_path.read_text(encoding="utf-8"))

    return ""


class RpcClient:
    def __init__(self, url: str, api_key: str = "", timeout: int = 30):
        self.url = url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def call(self, method: str, *params: Any) -> Any:
        payload = {
            "method": method,
            "params": list(params),
            "id": 1,
        }
        if self.api_key:
            payload["key"] = self.api_key

        request = urllib.request.Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise RuntimeError(
                f"RPC {method} failed with HTTP {error.code}"
            ) from error

        rpc_error = body.get("error")
        if rpc_error:
            raise RuntimeError(rpc_error.get("message") or str(rpc_error))

        return body.get("result")


class PublicIndexerClient:
    def __init__(self, base_url: str, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def get_json(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        query = urllib.parse.urlencode(params or {})
        url = f"{self.base_url}{path}"
        if query:
            url = f"{url}?{query}"

        request = urllib.request.Request(
            url,
            headers={"Accept": "application/json"},
            method="GET",
        )

        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    def paged(self, path: str, limit: int = 100) -> Iterable[Dict[str, Any]]:
        continuation_token: Optional[str] = None
        while True:
            params: Dict[str, Any] = {"limit": limit}
            if continuation_token:
                params["continuationToken"] = continuation_token

            payload = self.get_json(path, params=params)
            items = payload.get("result") or []
            if not isinstance(items, list):
                raise RuntimeError(f"Unexpected result payload for {path}")

            for item in items:
                if isinstance(item, dict):
                    yield item

            continuation_token = payload.get("continuationToken")
            if not continuation_token:
                break


def normalize_words(value: Any) -> Dict[str, str]:
    words = value if isinstance(value, dict) else {}
    word1 = words.get("word1") if isinstance(words.get("word1"), dict) else {}
    word2 = words.get("word2") if isinstance(words.get("word2"), dict) else {}
    return {
        "word1": trim_text(word1.get("name")),
        "word2": trim_text(word2.get("name")),
    }


def build_public_epoch_cache(
    indexer: PublicIndexerClient,
    epoch: int,
    fallback_cache_path: Path,
    force_refresh: bool = False,
) -> Dict[str, Any]:
    if not force_refresh:
        cached = read_json(fallback_cache_path)
        if isinstance(cached, dict):
            return cached

    flips = list(indexer.paged(f"/Epoch/{epoch}/Flips", limit=100))
    bad_authors = list(indexer.paged(f"/Epoch/{epoch}/Authors/Bad", limit=100))

    payload = {
        "schemaVersion": "idena.flip-index.v1",
        "indexerType": "public-indexer-fallback",
        "epoch": epoch,
        "fetchedAt": iso_now(),
        "baseUrl": indexer.base_url,
        "flipCount": len(flips),
        "badAuthorCount": len(bad_authors),
        "flips": [
            {
                "cid": trim_text(item.get("cid")),
                "author": trim_text(item.get("author")).lower(),
                "epoch": safe_int(item.get("epoch"), epoch),
                "shortRespCount": safe_int(item.get("shortRespCount")),
                "longRespCount": safe_int(item.get("longRespCount")),
                "status": trim_text(item.get("status")),
                "answer": trim_text(item.get("answer")),
                "wrongWords": bool(item.get("wrongWords")),
                "wrongWordsVotes": safe_int(item.get("wrongWordsVotes")),
                "timestamp": trim_text(item.get("timestamp")),
                "withPrivatePart": bool(item.get("withPrivatePart")),
                "grade": item.get("grade"),
                "gradeScore": safe_float(item.get("gradeScore")),
                "words": normalize_words(item.get("words")),
            }
            for item in flips
            if trim_text(item.get("cid"))
        ],
        "authorsBad": [
            {
                "address": trim_text(item.get("address")).lower(),
                "reason": trim_text(item.get("reason")),
                "wrongWords": bool(item.get("wrongWords")),
                "prevState": trim_text(item.get("prevState")),
                "state": trim_text(item.get("state")),
            }
            for item in bad_authors
            if trim_text(item.get("address"))
        ],
    }
    write_json_atomic(fallback_cache_path, payload)
    return payload


def maybe_fetch_flip_payload(
    rpc: RpcClient,
    flip_hash: str,
    payload_dir: Path,
    enable_fetch: bool,
) -> Dict[str, Any]:
    payload_path = payload_dir / f"{flip_hash}.json"

    if payload_path.exists():
        cached = read_json(payload_path, {})
        if isinstance(cached, dict):
            return {
                "available": True,
                "path": str(payload_path),
                "words": cached.get("words") or {},
                "error": "",
            }

    if not enable_fetch:
        return {
            "available": False,
            "path": None,
            "words": {},
            "error": "flip_payload_fetch_disabled",
        }

    try:
        flip_payload = rpc.call("flip_get", flip_hash)
        words_payload = rpc.call("flip_words", flip_hash)
    except Exception as error:  # noqa: BLE001
        return {
            "available": False,
            "path": None,
            "words": {},
            "error": str(error),
        }

    normalized_payload = {
        "hash": flip_hash,
        "hex": trim_text(flip_payload.get("hex")),
        "privateHex": trim_text(flip_payload.get("privateHex")),
        "words": words_payload.get("words") if isinstance(words_payload, dict) else [],
        "capturedAt": iso_now(),
    }
    write_json_atomic(payload_path, normalized_payload)
    raw_words = normalized_payload.get("words") or []
    words = {}
    if isinstance(raw_words, list) and len(raw_words) >= 2:
        words = {"word1Index": raw_words[0], "word2Index": raw_words[1]}

    return {
        "available": True,
        "path": str(payload_path),
        "words": words,
        "error": "",
    }


def build_author_counters(flip_rows: Iterable[Dict[str, Any]], extra_flip_baseline: int) -> Tuple[Dict[str, int], Dict[str, int]]:
    counts: Counter[str] = Counter()
    flagged: Counter[str] = Counter()

    for item in flip_rows:
        author = trim_text(item.get("author")).lower()
        if not author:
            continue

        counts[author] += 1
        status = trim_text(item.get("status")).lower()
        wrong_words = bool(item.get("wrongWords"))
        wrong_words_votes = safe_int(item.get("wrongWordsVotes"))

        if status in {"reported", "notqualified"} or wrong_words or wrong_words_votes > 0:
            flagged[author] += 1

    extra = {
        author: max(total - extra_flip_baseline, 0)
        for author, total in counts.items()
    }
    repeat_report = {
        author: max(total - 1, 0)
        for author, total in flagged.items()
    }
    return extra, repeat_report


def build_local_epoch_snapshot(
    *,
    epoch: int,
    captures: List[Dict[str, Any]],
    rpc: RpcClient,
    local_index_path: Path,
    payload_dir: Path,
    fetch_flip_payloads: bool,
) -> Dict[str, Any]:
    flips = []
    for capture in captures:
        payload = maybe_fetch_flip_payload(
            rpc,
            capture["flipHash"],
            payload_dir=payload_dir,
            enable_fetch=fetch_flip_payloads,
        )
        flips.append(
            {
                "cid": capture["flipHash"],
                "epoch": capture["epoch"],
                "sessionType": capture.get("sessionType"),
                "panelCount": capture.get("panelCount"),
                "timestamp": capture.get("timestamp"),
                "capturedAt": capture.get("capturedAt"),
                "consensus": capture.get("consensus") or {},
                "payloadAvailable": bool(payload["available"]),
                "payloadPath": payload["path"],
                "payloadError": payload["error"],
                "localNodeWords": payload["words"],
            }
        )

    payload = {
        "schemaVersion": "idena.flip-index.v1",
        "indexerType": "local-node-indexer",
        "epoch": epoch,
        "generatedAt": iso_now(),
        "sourcePriority": "local-node-first",
        "flipCount": len(flips),
        "flips": flips,
    }
    write_json_atomic(local_index_path, payload)
    return payload


def needs_public_fallback(local_entry: Dict[str, Any]) -> bool:
    return not trim_text(local_entry.get("author")) and not safe_float(
        local_entry.get("gradeScore")
    )


def merge_candidate_item(
    *,
    capture: Dict[str, Any],
    local_entry: Dict[str, Any],
    public_entry: Optional[Dict[str, Any]],
    bad_authors: Dict[str, Dict[str, Any]],
    extra_flip_counts: Dict[str, int],
    repeat_report_counts: Dict[str, int],
    ranking_policy: Any,
    require_flip_payloads: bool,
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    flip_hash = capture["flipHash"]
    consensus = capture.get("consensus") or {}
    public_words = normalize_words((public_entry or {}).get("words"))
    author = trim_text((public_entry or {}).get("author") or local_entry.get("author")).lower()
    status = trim_text((public_entry or {}).get("status") or local_entry.get("status"))
    bad_author_row = bad_authors.get(author, {}) if author else {}
    ranking_source = (
        "local_node_indexer"
        if public_entry is None
        else "public_indexer_fallback"
    )

    payload_path = trim_text(local_entry.get("payloadPath"))
    reasons: List[str] = []
    if not consensus.get("finalAnswer") and not consensus.get("reported"):
        reasons.append("missing_consensus")
    if require_flip_payloads and not payload_path:
        reasons.append("missing_flip_payload")

    signals = build_modern_signals(
        cid=flip_hash,
        author=author,
        epoch=capture.get("epoch"),
        consensus_label=consensus.get("finalAnswer") or ("reported" if consensus.get("reported") else ""),
        consensus_strength=trim_text(consensus.get("strength")),
        votes_reported=safe_int((public_entry or {}).get("wrongWordsVotes") or 0),
        grade_score=safe_float((public_entry or {}).get("gradeScore")),
        grade=(public_entry or {}).get("grade"),
        status=status,
        wrong_words_votes=safe_int((public_entry or {}).get("wrongWordsVotes")),
        short_resp_count=safe_int((public_entry or {}).get("shortRespCount")),
        long_resp_count=safe_int((public_entry or {}).get("longRespCount")),
        with_private_part=bool((public_entry or {}).get("withPrivatePart")),
        author_bad_reason=trim_text(bad_author_row.get("reason")),
        author_bad_wrong_words=bool(
            bad_author_row.get("wrongWords") or trim_text(bad_author_row.get("reason")) == "WrongWords"
        ),
        author_repeat_report_offenses=safe_int(repeat_report_counts.get(author)),
        author_extra_flip_count=safe_int(extra_flip_counts.get(author)),
        ranking_source=ranking_source,
        policy=ranking_policy,
    )

    if signals.excluded:
        reasons.append(signals.exclusion_reason)

    base_item = {
        "flipHash": flip_hash,
        "cid": flip_hash,
        "epoch": capture.get("epoch"),
        "sessionType": capture.get("sessionType"),
        "panelCount": capture.get("panelCount"),
        "timestamp": capture.get("timestamp"),
        "capturedAt": capture.get("capturedAt"),
        "payloadPath": payload_path or None,
        "words": {
            "localNode": local_entry.get("localNodeWords") or {},
            "publicIndexer": public_words,
        },
        "source": {
            "kind": signals.source_kind,
            "name": signals.source_name,
            "priority": signals.source_priority,
        },
        "rankingSource": signals.ranking_source,
        "consensusLabel": signals.consensus_label or None,
        "consensusStrength": signals.consensus_strength or None,
        "trainingWeight": signals.training_weight,
        "audit": signals.to_dict(),
    }

    if reasons:
        return None, {
            "flipHash": flip_hash,
            "reasons": sorted(set(reason for reason in reasons if reason)),
            "audit": signals.to_dict(),
        }

    return base_item, None


def resolve_user_data_dir(value: Optional[str]) -> Path:
    if value:
        return Path(value).expanduser().resolve()
    return (Path.home() / "Library" / "Application Support" / "IdenaAI").resolve()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Collect modern FLIP training candidates with local-node-first ranking."
    )
    parser.add_argument("--epoch", type=int, required=True, help="Epoch to collect.")
    parser.add_argument(
        "--user-data-dir",
        default="",
        help="IdenaAI user data directory (default: ~/Library/Application Support/IdenaAI).",
    )
    parser.add_argument("--settings-path", default="", help="Optional settings.json path override.")
    parser.add_argument("--capture-index", default="", help="Optional captures/index.json path override.")
    parser.add_argument("--rpc-url", default="", help="Optional RPC URL override.")
    parser.add_argument("--rpc-key", default="", help="Optional RPC API key override.")
    parser.add_argument(
        "--indexer-url",
        default=DEFAULT_INDEXER_BASE_URL,
        help="Public indexer base URL for fallback only.",
    )
    parser.add_argument(
        "--allow-public-indexer-fallback",
        action="store_true",
        default=False,
        help="Allow public indexer fallback when local ranking metadata is missing.",
    )
    parser.add_argument(
        "--fetch-flip-payloads",
        action="store_true",
        default=False,
        help="Fetch and cache decrypted flip payloads from the local node.",
    )
    parser.add_argument(
        "--require-flip-payloads",
        action="store_true",
        default=False,
        help="Exclude items whose decrypted flip payload could not be cached.",
    )
    parser.add_argument(
        "--refresh-public-fallback",
        action="store_true",
        default=False,
        help="Ignore any cached public fallback snapshot and fetch it again.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    user_data_dir = resolve_user_data_dir(args.user_data_dir)
    settings_path = (
        Path(args.settings_path).expanduser().resolve()
        if trim_text(args.settings_path)
        else user_data_dir / "settings.json"
    )
    capture_index_path = (
        Path(args.capture_index).expanduser().resolve()
        if trim_text(args.capture_index)
        else user_data_dir / "local-ai" / "captures" / "index.json"
    )

    local_index_path = (
        user_data_dir
        / "local-ai"
        / "indexer"
        / "epochs"
        / f"epoch-{args.epoch}.json"
    )
    fallback_cache_path = (
        user_data_dir
        / "local-ai"
        / "indexer-fallback"
        / "epochs"
        / f"epoch-{args.epoch}.json"
    )
    modern_payload_dir = (
        user_data_dir / "local-ai" / "modern-payloads" / f"epoch-{args.epoch}"
    )
    output_package_path = (
        user_data_dir
        / "local-ai"
        / "training-candidates"
        / f"epoch-{args.epoch}-modern-candidates.json"
    )

    settings = load_settings(settings_path)
    ranking_policy_config = settings.get("localAi", {}).get("rankingPolicy")
    if not isinstance(ranking_policy_config, dict):
        ranking_policy_config = settings.get("rankingPolicy")
    ranking_policy = build_ranking_policy(ranking_policy_config)
    extra_flip_baseline = safe_int(
        (ranking_policy_config or {}).get("extraFlipBaseline"), 3
    )

    rpc = RpcClient(
        url=resolve_rpc_url(args, settings),
        api_key=resolve_rpc_key(args, settings, user_data_dir),
    )

    captures = load_capture_index(capture_index_path, args.epoch)
    local_snapshot = build_local_epoch_snapshot(
        epoch=args.epoch,
        captures=captures,
        rpc=rpc,
        local_index_path=local_index_path,
        payload_dir=modern_payload_dir,
        fetch_flip_payloads=args.fetch_flip_payloads,
    )

    local_entries = {
        trim_text(item.get("cid")): item
        for item in local_snapshot.get("flips", [])
        if trim_text(item.get("cid"))
    }

    public_snapshot: Dict[str, Any] = {}
    public_flips_by_cid: Dict[str, Dict[str, Any]] = {}
    bad_authors_by_address: Dict[str, Dict[str, Any]] = {}
    extra_flip_counts: Dict[str, int] = {}
    repeat_report_counts: Dict[str, int] = {}

    if args.allow_public_indexer_fallback and any(
        needs_public_fallback(local_entries.get(capture["flipHash"], {}))
        for capture in captures
    ):
        indexer = PublicIndexerClient(args.indexer_url)
        public_snapshot = build_public_epoch_cache(
            indexer,
            args.epoch,
            fallback_cache_path,
            force_refresh=args.refresh_public_fallback,
        )
        public_flips_by_cid = {
            trim_text(item.get("cid")): item
            for item in public_snapshot.get("flips", [])
            if trim_text(item.get("cid"))
        }
        bad_authors_by_address = {
            trim_text(item.get("address")).lower(): item
            for item in public_snapshot.get("authorsBad", [])
            if trim_text(item.get("address"))
        }
        extra_flip_counts, repeat_report_counts = build_author_counters(
            public_snapshot.get("flips", []),
            extra_flip_baseline=extra_flip_baseline,
        )

    items: List[Dict[str, Any]] = []
    excluded: List[Dict[str, Any]] = []

    for capture in captures:
        local_entry = local_entries.get(capture["flipHash"], {})
        public_entry = public_flips_by_cid.get(capture["flipHash"])
        item, excluded_item = merge_candidate_item(
            capture=capture,
            local_entry=local_entry,
            public_entry=public_entry,
            bad_authors=bad_authors_by_address,
            extra_flip_counts=extra_flip_counts,
            repeat_report_counts=repeat_report_counts,
            ranking_policy=ranking_policy,
            require_flip_payloads=args.require_flip_payloads,
        )
        if item:
            items.append(item)
        elif excluded_item:
            excluded.append(excluded_item)

    package = {
        "schemaVersion": "idena.flip-training.v1",
        "packageType": "idena-modern-flip-training-candidates",
        "epoch": args.epoch,
        "createdAt": iso_now(),
        "sourcePriority": "local-node-first",
        "settingsPath": str(settings_path),
        "captureIndexPath": str(capture_index_path),
        "localIndexPath": str(local_index_path),
        "fallbackIndexPath": str(fallback_cache_path) if public_snapshot else None,
        "eligibleCount": len(items),
        "excludedCount": len(excluded),
        "rankingPolicy": {
            **(ranking_policy_config or {}),
            "effective": ranking_policy.__dict__,
            "extraFlipBaseline": extra_flip_baseline,
        },
        "items": items,
        "excluded": excluded,
    }
    write_json_atomic(output_package_path, package)

    print(
        json.dumps(
            {
                "epoch": args.epoch,
                "captureCount": len(captures),
                "eligibleCount": len(items),
                "excludedCount": len(excluded),
                "packagePath": str(output_package_path),
                "localIndexPath": str(local_index_path),
                "fallbackUsed": bool(public_snapshot),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
