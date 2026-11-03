#!/usr/bin/env python3
"""Technical documentation gate; standard library only. Never automatically sync."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ARCH = "docs/技术架构.md"
MANIFEST = "docs/技术文档同步.json"
SECTIONS = ("目标与范围", "技术栈", "模块与目录", "数据模型", "接口与契约", "关键流程",
            "部署与配置", "安全与隐私", "测试与验收", "技术决策", "迭代同步")
CODE = set(".py .pyw .js .mjs .cjs .jsx .ts .tsx .vue .svelte .html .htm .css .scss .sass .less .sql .ipynb .sh .bash .zsh .ps1 .bat .cmd .go .rs .java .kt .kts .swift .c .h .cc .cpp .hpp .cs .rb .php .lua .r .dart .scala .ex .exs .erl .hs .pl .clj .jl .m .mm .proto .graphql .gql .tf .tfvars".split())
CONFIG = set(".json .yaml .yml .toml .ini .cfg .xml .lock .gradle .cmake".split())
NAMES = {"Dockerfile", "Containerfile", "Makefile", "CMakeLists.txt", "Procfile", "Gemfile",
         "Gemfile.lock", "go.mod", "go.sum", "requirements.txt", "Pipfile", "Pipfile.lock",
         ".gitignore", ".dockerignore", ".nvmrc", ".python-version", "Jenkinsfile"}
EXCLUDE = set(".git .claude .codex .ssh .aws .config node_modules vendor .venv venv env __pycache__ .next .nuxt dist build target coverage .cache .pytest_cache .mypy_cache .tox .idea .vscode uploads user_data userdata logs secrets credentials .terraform .gradle site-packages".split())
MAX_ENTRIES, MAX_DEPTH, MAX_BYTES = 20000, 16, 32 * 1024 * 1024
PLACEHOLDER = re.compile(r"\b(?:TODO|TBD|FIXME)\b|待填写|待补充|待完善|占位|<[^>]*填写[^>]*>", re.I)


class GateError(Exception):
    pass


def excluded(path):
    parts = [s.lower() for s in Path(path).parts]
    name = parts[-1] if parts else ""
    return (any(s in EXCLUDE for s in parts) or name.startswith(".env") or
            re.search(r"(?:^|[._-])(?:secrets?|credentials?)(?:[._-]|$)", name) is not None or
            name in {"id_rsa", "id_ed25519", ".npmrc", ".pypirc", ".netrc"} or
            Path(name).suffix in {".pem", ".key", ".p12", ".pfx", ".db", ".sqlite", ".sqlite3"})


def technical(path):
    p = Path(path)
    return str(p) != MANIFEST and not excluded(p) and (p.suffix.lower() in CODE | CONFIG or p.name in NAMES or
                               p.name.startswith(("Dockerfile.", "requirements")) and p.suffix == ".txt")


def broad_root(root):
    return (root in {Path.home().resolve(), Path("/")} or
            root.is_relative_to(Path.home().resolve() / ".claude") or
            root.name in {"第二大脑", "项目区", "进行中", "已完成", "已存档", "人物库", "知识库", "语料库", "收集箱", "灵感箱", "创作区"})


def safe_path(root, rel):
    p = root / rel
    if not p.is_relative_to(root) or ".." in Path(rel).parts or any(x.is_symlink() for x in [p, *p.parents] if x.is_relative_to(root)):
        raise GateError("受控路径越界或符号链接，无法安全检查: " + str(rel))
    return p


def content(root, rel):
    p = safe_path(root, rel)
    if p.stat().st_size > MAX_BYTES:
        raise GateError("文件超过32MiB检查上限: " + rel)
    data = p.read_bytes()
    if b"\0" in data:
        raise GateError("受控技术文件包含二进制内容，无法检查: " + rel)
    return data


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_paths(root):
    if broad_root(root):
        raise GateError("请指定实际项目根目录；禁止扫描主目录、第二大脑全库或全局规则目录")
    if not root.is_dir():
        raise GateError("项目根目录不存在")
    if (root / ".git").exists():
        result = subprocess.run(["git", "-C", str(root), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                                capture_output=True, timeout=10)
        if result.returncode:
            raise GateError("git ls-files 失败；未完成检查")
        paths = set(os.fsdecode(s) for s in result.stdout.split(b"\0") if s)
        if len(paths) > MAX_ENTRIES:
            raise GateError("Git文件清单超过20000项；请缩小项目范围")
        return sorted(p for p in paths if technical(p) and safe_path(root, p).exists())
    paths, count, stack = [], 0, [(root, 0)]
    while stack:
        directory, depth = stack.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                count += 1
                if count > MAX_ENTRIES:
                    raise GateError("非Git扫描超过20000项；未完成检查")
                rel = str(Path(entry.path).relative_to(root))
                if excluded(rel):
                    continue
                if entry.is_dir(follow_symlinks=False):
                    if depth >= MAX_DEPTH:
                        raise GateError("非Git扫描超过16层；未完成检查: " + rel)
                    if (Path(entry.path) / ".git").exists():
                        raise GateError("发现嵌套项目，请以实际项目根运行: " + rel)
                    stack.append((Path(entry.path), depth + 1))
                elif technical(rel):
                    paths.append(rel)
    return sorted(paths)


def architecture(root):
    if not (root / ARCH).exists():
        return None, ["缺少 " + ARCH]
    data = content(root, ARCH)
    text = data.decode("utf-8")
    # Ignore fenced examples and HTML comments: they cannot supply required headings.
    visible = re.sub(r"```.*?```|~~~.*?~~~|<!--.*?-->", "", text, flags=re.S)
    chunks = re.split(r"(?m)^##\s+(.+?)\s*$", visible)
    sections = dict(zip(chunks[1::2], chunks[2::2]))
    errors = []
    for required in SECTIONS:
        body = next((v for k, v in sections.items() if required in k), "")
        meaningful = re.sub(r"(?m)^#+.*$", "", body).strip(" \n\t*-:：")
        if len(meaningful) < 12 or PLACEHOLDER.search(body):
            errors.append("架构章节缺失、空白或仍为样板: " + required)
    return digest(data), errors


def load_manifest(root):
    if not (root / MANIFEST).exists():
        return None
    obj = json.loads(content(root, MANIFEST))
    if (not isinstance(obj, dict) or obj.get("version") != 1 or
            not isinstance(obj.get("fingerprints"), dict) or not isinstance(obj.get("records"), list) or
            not obj["records"] or not isinstance(obj.get("doc_hash"), str) or
            any(not isinstance(k, str) or not isinstance(v, str) for k, v in obj["fingerprints"].items())):
        raise GateError("同步manifest格式无效；请核实后显式sync，不能自动覆盖")
    return obj


def inspect(root):
    paths = file_paths(root)
    fingerprints = {p: digest(content(root, p)) for p in paths}
    old = load_manifest(root)
    has_code = any(Path(p).suffix.lower() in CODE or Path(p).name in {"Dockerfile", "Makefile", "Jenkinsfile"} for p in paths)
    if not has_code and old is None:
        return fingerprints, None, old, [], False
    doc_hash, errors = architecture(root)
    if old is None:
        errors.append("缺少 " + MANIFEST + "；审阅架构后执行显式sync")
    else:
        changed = sorted(p for p in fingerprints.keys() | old["fingerprints"].keys() if fingerprints.get(p) != old["fingerprints"].get(p))
        if changed:
            errors.append("技术文件未同步（含新增/删除）: " + ", ".join(changed[:10]) + (" …" if len(changed) > 10 else ""))
        if old["doc_hash"] != doc_hash:
            errors.append("架构文档变化未登记sync")
    return fingerprints, doc_hash, old, errors, True


def sync(root, summary, impact, sections):
    fingerprints, doc_hash, old, _, active = inspect(root)
    if not active:
        raise GateError("无自有代码，跳过；不创建同步manifest")
    _, errors = architecture(root)
    if errors:
        raise GateError("；".join(errors))
    if len(summary.strip()) < 8 or len(sections.strip()) < 8 or PLACEHOLDER.search(summary + sections):
        raise GateError("summary/sections必须写具体变更及章节/无影响原因，不能使用样板")
    if old and impact == "architecture" and old["doc_hash"] == doc_hash:
        raise GateError("architecture同步要求先实质更新架构文档（hash未变化）")
    if impact == "implementation" and (len(sections.strip()) < 20 or not re.search(r"因为|原因|仅|because|only", sections, re.I)):
        raise GateError("implementation的sections须具体说明为什么对架构无影响（>=20字，包含因为/原因/仅/because/only）")
    record = {"date": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
              "summary": summary.strip(), "impact": impact, "sections": sections.strip(), "doc_hash": doc_hash}
    obj = {"version": 1, "doc_hash": doc_hash, "fingerprints": fingerprints,
           "records": (old["records"] if old else []) + [record]}
    target = safe_path(root, MANIFEST)
    fd, temp = tempfile.mkstemp(prefix=".technical-docs-", dir=target.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(temp, target)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def project_root(start, fallback=None):
    candidates = []
    for p in [start, *start.parents]:
        if broad_root(p):
            break
        candidates.append(p)
    # Highest priority: direct project root with .git or docs/技术架构.md
    for p in candidates:
        if (p / ".git").exists() or (p / ARCH).exists():
            return p
    # Secondary: package/build manifests (e.g. non-git repos)
    for p in candidates:
        if any((p / n).exists() for n in ("package.json", "pyproject.toml", "Cargo.toml", "go.mod")):
            return p
    return fallback


def hook(payload, event=None):
    event = event or payload.get("hook_event_name", "")
    cwd = Path(payload.get("cwd") or os.getcwd()).resolve()
    tool = payload.get("tool_name")
    arg = payload.get("tool_input") or {}
    raw = arg.get("file_path") or arg.get("notebook_path")
    target = ((cwd / raw).absolute() if raw else None)
    if target and excluded(target):
        return {}
    root = project_root(target.parent if target else cwd, cwd if not broad_root(cwd) else None)
    if root is None or broad_root(root):
        return {}
    if event == "PreToolUse":
        if tool not in {"Write", "Edit", "NotebookEdit"} or target is None or not technical(target):
            return {}
        if not target.is_relative_to(root):
            return {"systemMessage": "无法确定目标项目根，请进入实际项目后运行检查"}
        try:
            _, issues = architecture(root)
        except (GateError, OSError, ValueError) as exc:
            issues = [str(exc)]
        if issues:
            return {"hookSpecificOutput": {"hookEventName": event, "permissionDecision": "deny",
                    "permissionDecisionReason": "先创建/完善架构再写技术文件。" + "；".join(issues)}}
        return {}  # Never issue allow: preserve the existing permission system.
    if event == "PostToolUse" and tool not in {"Write", "Edit", "NotebookEdit", "Bash"}:
        return {}
    if event not in {"SessionStart", "PostToolUse", "Stop"}:
        return {}
    try:
        fp, dh, old, errors, active = inspect(root)
        signature = digest(json.dumps([fp, dh, old, errors], sort_keys=True).encode())
    except (GateError, OSError, ValueError, subprocess.SubprocessError) as exc:
        errors, active, signature = ["技术文档检查未完成: " + str(exc)], True, digest(str(exc).encode())
    if not active:
        return {}
    state_key = digest((str(root) + str(payload.get("session_id", "unknown"))).encode())
    state = Path(tempfile.gettempdir()) / ("technical-docs-stop-" + str(os.getuid()) + "-" + state_key)
    message = "；".join(errors) if errors else "技术文档同步检查通过；仍需独立专家验收语义、设计和目标环境。"
    if event == "SessionStart":
        state.unlink(missing_ok=True)
        return {"hookSpecificOutput": {"hookEventName": event, "additionalContext": "先读 " + str(root / ARCH) + "。" + message}}
    if event == "Stop" and errors:
        if state.exists() and state.read_text() == signature:
            return {"systemMessage": message + "。同一错误未变化，本会话不反复阻塞；此退出不代表验收通过，CLI/CI仍失败。"}
        state.write_text(signature)
        return {"decision": "block", "reason": message + "。审阅/修正后显式sync，再执行check；不能自动sync。"}
    if event == "Stop":
        state.unlink(missing_ok=True)
        return {}
    return {"hookSpecificOutput": {"hookEventName": event, "additionalContext": message}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for cmd in ("check", "sync"):
        p = sub.add_parser(cmd)
        p.add_argument("--root", default=".")
        if cmd == "sync":
            p.add_argument("--summary", required=True)
            p.add_argument("--impact", choices=("architecture", "implementation"), required=True)
            p.add_argument("--sections", required=True)
    sub.add_parser("hook").add_argument("--event", choices=("SessionStart", "PreToolUse", "PostToolUse", "Stop"))
    args = parser.parse_args()
    try:
        if args.command == "hook":
            payload = json.load(sys.stdin)
            if not isinstance(payload, dict):
                raise GateError("hook stdin须为JSON对象")
            print(json.dumps(hook(payload, args.event), ensure_ascii=False))
        elif args.command == "sync":
            sync(Path(args.root).resolve(), args.summary, args.impact, args.sections)
            print("已显式登记同步；这不代表专家验收通过。")
        else:
            _, _, _, errors, active = inspect(Path(args.root).resolve())
            print("；".join(errors) if errors else "同步检查通过" if active else "无自有代码，跳过")
            return int(bool(errors))
    except (GateError, OSError, ValueError, subprocess.SubprocessError) as exc:
        print("技术文档检查失败: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
