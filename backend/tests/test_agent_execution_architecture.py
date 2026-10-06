"""Keep the new execution boundaries directional without a framework or locator."""

import ast
from pathlib import Path

ROOT = Path(__file__).parents[1] / "src/qunxue_api/adapters/research_agent"


def imported_modules(source):
    return {node.module or "" for node in ast.walk(ast.parse(source))
            if isinstance(node, ast.ImportFrom)}


def test_runner_orchestrates_but_does_not_define_registered_tools_or_sdk_wire_methods():
    source = (ROOT / "pydantic_runner.py").read_text()
    tree = ast.parse(source)
    assert "register_agent_tools(self._agent, self._tool_runtime)" in source
    assert not any(isinstance(node, ast.Attribute) and node.attr == "tool"
                   for node in ast.walk(tree))
    assert not any(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                   and node.name in {"_completions_create", "_responses_create"}
                   for node in ast.walk(tree))
    assert "self._tool_runtime._active_" not in source


def test_protocol_events_and_bindings_cannot_depend_back_on_runner_or_storage():
    paths = [ROOT / name for name in (
        "model_protocol.py", "stream_events.py", "tool_runtime.py", "tool_support.py",
    )] + list((ROOT / "tool_bindings").glob("*.py"))
    for path in paths:
        imports = imported_modules(path.read_text())
        assert not any("pydantic_runner" in name or "sqlite" in name or "sqlalchemy" in name
                       for name in imports), path
    protocol = imported_modules((ROOT / "model_protocol.py").read_text())
    assert not any("tool_bindings" in name or "tool_runtime" in name for name in protocol)


def test_capabilities_are_explicitly_composed_without_dynamic_discovery():
    source = (ROOT / "tool_bindings/__init__.py").read_text()
    tree = ast.parse(source)
    registration = next(node for node in tree.body if isinstance(node, ast.FunctionDef))
    calls = [node.value.func.id for node in registration.body
             if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)]
    assert calls == [
        "register_memory_tools", "register_knowledge_search_tool", "register_web_tools",
        "register_material_tools", "register_analysis_tools", "register_knowledge_read_tools",
        "register_workflow_tools", "register_writing_tools", "register_document_tools",
        "register_research_map_tools",
    ]
    assert not any(isinstance(node, (ast.For, ast.AsyncFor, ast.While)) for node in ast.walk(tree))
