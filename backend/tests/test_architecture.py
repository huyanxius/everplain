import ast
from inspect import signature
from pathlib import Path

from qunxue_api.adapters.sqlite.research_task_repository import (
    SqliteResearchTaskRepository,
)
from qunxue_api.modules import research_intake
from qunxue_api.modules.research_intake import ResearchTaskRepository

PACKAGE_ROOT = Path(__file__).parents[1] / "src" / "qunxue_api"
MODULES_ROOT = PACKAGE_ROOT / "modules"
MODULE_PACKAGE = "qunxue_api.modules"
ALLOWED_MODULE_DEPENDENCIES = {
    "account_management": {"identity"},
    "agent_conversation": set(),
    "agent_memory": set(),
    "agent_profile": set(),
    "writing": set(),
    "knowledge_import": set(),
    "personal_graph": set(),
    "external_agents": set(),
    "channel_gateway": set(),
    "model_catalog": set(),
    "subscriptions": set(),
    "shared_knowledge": set(),
    "billing": set(),
    "identity": set(),
    "knowledge_catalog": set(),
    "research_intake": set(),
    "research_analysis": {"research_materials"},
    "research_cycle": {
        "research_analysis",
        "research_materials",
        "theory_matching",
    },
    "research_exchange": set(),
    "research_materials": set(),
    "research_method": set(),
    "transcription": set(),
    "theory_matching": {"knowledge_catalog", "research_intake"},
    "research_framework": {"theory_matching"},
}
ALLOWED_CROSS_MODULE_SYMBOLS = {
    ("research_analysis", "research_materials"): {"MaterialLocator"},
    ("research_cycle", "research_analysis"): {
        "AnalysisCodeStatus",
        "AnalysisRecordStatus",
        "ComparisonFindingKind",
        "ResearchAnalysisHandoff",
    },
    ("research_cycle", "research_materials"): {
        "MaterialKind",
        "ProfessionalMaterialArchiveView",
        "ResearchMaterial",
    },
    ("research_cycle", "theory_matching"): {"ConfirmedTheoryPlanSnapshot"},
    ("account_management", "identity"): {
        "AccountRole",
        "AccountStatus",
    },
    ("theory_matching", "knowledge_catalog"): {
        "KnowledgeReleaseRef",
        "SourceRecordSnapshot",
        "SourceVerificationStatus",
        "TheoryProfileSnapshot",
    },
    ("theory_matching", "research_intake"): {
        "ConfirmedPhenomenonSnapshot",
    },
    ("research_framework", "theory_matching"): {
        "ConfirmedTheoryPlanSnapshot",
    },
}
ALLOWED_TOP_LEVEL_DEPENDENCIES = {
    "account_extension": {"adapters", "api", "modules"},
    "modules": {"modules"},
    "application": {"application", "modules"},
    "api": {"api", "application", "modules", "settings"},
    "adapters": {"adapters", "modules"},
    "bootstrap": {
        "account_extension",
        "adapters",
        "api",
        "application",
        "modules",
        "settings",
    },
    "settings": set(),
    "retrieval_preflight": {"adapters", "settings"},
    "main": {"bootstrap"},
}
ALLOWED_MODULE_INTERNAL_DEPENDENCIES = {
    "domain": {"domain", "errors"},
    "errors": {"errors"},
    "ports": {"domain", "errors", "ports"},
    "service": {"domain", "errors", "ports", "service"},
}
MODULE_INTERNAL_ROLE_ALIASES = {
    "qualitative_workspace": "domain",
    "research_map": "domain",
    "canvas_editing": "domain",
}
# These existing files mix public contracts, pure transformations or small services.
# They retain the global business/module boundary checks but are not falsely
# assigned domain/ports/service layering. New flat files require explicit review.
REGISTERED_FLAT_MODULE_FILES = {
    "agent_conversation/context.py",
    "agent_conversation/context_suggestion.py",
    "agent_conversation/model_selection.py",
    "agent_conversation/summary.py",
    "agent_conversation/writing_preview.py",
    "billing/pricing.py",
    "knowledge_catalog/public.py",
    "research_analysis/batch.py",
    "research_exchange/archive.py",
    "research_exchange/audit.py",
    "research_exchange/model.py",
    "research_exchange/qdpx.py",
    "research_framework/document.py",
    "research_framework/proposals.py",
    "research_framework/public.py",
    "research_materials/literature_exchange.py",
    "research_materials/professional.py",
    "research_materials/professional_ports.py",
    "theory_matching/matching.py",
    "theory_matching/public.py",
    "theory_matching/rules.py",
    "writing/evidence.py",
    "writing/grounding.py",
}

FORBIDDEN_INTERNAL_PREFIXES = (
    "qunxue_api.adapters",
    "qunxue_api.api",
    "qunxue_api.application",
    "qunxue_api.bootstrap",
    "qunxue_api.main",
    "qunxue_api.settings",
)
FORBIDDEN_FRAMEWORK_PREFIXES = (
    "fastapi",
    "pydantic",
    "pydantic_core",
    "pydantic_settings",
    "sqlalchemy",
)
CONCRETE_PROVIDER_PREFIXES = (
    "anthropic",
    "cohere",
    "dashscope",
    "google.genai",
    "google.generativeai",
    "mistralai",
    "ollama",
    "openai",
    "qianfan",
    "volcenginesdkarkruntime",
    "zhipuai",
)
FORBIDDEN_BUSINESS_PREFIXES = (
    *FORBIDDEN_INTERNAL_PREFIXES,
    *FORBIDDEN_FRAMEWORK_PREFIXES,
    *CONCRETE_PROVIDER_PREFIXES,
)


def _source_module(
    path: Path,
    package_root: Path = PACKAGE_ROOT,
) -> tuple[str, bool]:
    relative = path.relative_to(package_root).with_suffix("")
    parts = ["qunxue_api", *relative.parts]
    is_package = parts[-1] == "__init__"
    if is_package:
        parts.pop()
    return ".".join(parts), is_package


def _resolve_from_import(
    *,
    source_module: str,
    source_is_package: bool,
    imported_module: str | None,
    level: int,
) -> str:
    if level == 0:
        if imported_module is None:
            raise AssertionError("absolute from-import must name a module")
        return imported_module

    package_parts = source_module.split(".")
    if not source_is_package:
        package_parts.pop()
    parent_hops = level - 1
    if parent_hops >= len(package_parts):
        raise AssertionError(f"{source_module} imports beyond the package root")
    if parent_hops:
        package_parts = package_parts[:-parent_hops]
    if imported_module:
        package_parts.extend(imported_module.split("."))
    return ".".join(package_parts)


def _is_local_module(
    module_name: str,
    package_root: Path = PACKAGE_ROOT,
) -> bool:
    if module_name == "qunxue_api":
        return True
    if not module_name.startswith("qunxue_api."):
        return False
    candidate = package_root.joinpath(*module_name.split(".")[1:])
    return candidate.is_dir() or candidate.with_suffix(".py").is_file()


def _dynamic_imports(tree: ast.AST, package_root: Path = PACKAGE_ROOT) -> set[str]:
    """Conservative lexical may-alias analysis of explicit import loaders.

    Branch bindings are joined, not executed in sequence. Parameters and local
    names shadow outer aliases; deferred function bodies can see later global
    imports. Only import statements and simple name/attribute assignments are
    resolved, never runtime factories, reflection or computed import targets.
    """
    imports: set[str] = set()
    loaders = {"importlib.import_module", "builtins.__import__"}
    bindings = {"importlib", "builtins", *loaders}
    scopes = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)
    comprehensions = (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)

    def reference(node, aliases):
        if isinstance(node, ast.Name):
            return aliases.get(node.id, set())
        if isinstance(node, ast.Attribute):
            return {f"{parent}.{node.attr}" for parent in reference(node.value, aliases)} & bindings
        return set()

    def argument(node, position, name):
        return node.args[position] if len(node.args) > position else next(
            (item.value for item in node.keywords if item.arg == name), None,
        )

    def inspect_call(node, loader):
        name = argument(node, 0, "name")
        if not isinstance(name, ast.Constant) or not isinstance(name.value, str):
            imports.add("<unresolved dynamic import>")
            return
        if name.value.startswith("."):
            imports.add("<unresolved dynamic import>")
            return
        imports.add(name.value)
        if loader != "builtins.__import__":
            return
        level = argument(node, 4, "level")
        if level is not None and not (isinstance(level, ast.Constant) and level.value == 0):
            imports.add("<unresolved dynamic import>")
        fromlist = argument(node, 3, "fromlist")
        if fromlist is None or (isinstance(fromlist, ast.Constant) and fromlist.value is None):
            return
        if not isinstance(fromlist, (ast.List, ast.Tuple)) or any(
            not isinstance(item, ast.Constant) or not isinstance(item.value, str)
            for item in fromlist.elts
        ):
            imports.add("<unresolved dynamic import>")
            return
        for item in fromlist.elts:
            child = f"{name.value}.{item.value}"
            if item.value == "*":
                imports.add("<unresolved dynamic import>")
            elif _is_local_module(child, package_root) or _matches_prefix(
                child, CONCRETE_PROVIDER_PREFIXES,
            ):
                imports.add(child)

    def in_scope(node):
        yield node
        if isinstance(node, comprehensions):
            # Comprehension targets do not bind their surrounding scope.
            yield from in_scope(node.generators[0].iter)
            return
        if isinstance(node, scopes):
            # Definitions execute these expressions in their enclosing scope.
            if isinstance(node, ast.ClassDef):
                expressions = [*node.bases, *(item.value for item in node.keywords)]
            else:
                args = node.args
                expressions = [*args.defaults, *args.kw_defaults,
                               *(item.annotation for item in
                                 [*args.posonlyargs, *args.args, *args.kwonlyargs,
                                  args.vararg, args.kwarg] if item),
                               getattr(node, "returns", None)]
            for item in [*expressions, *getattr(node, "decorator_list", [])]:
                if item is not None:
                    yield from in_scope(item)
            return
        for item in ast.iter_child_nodes(node):
            yield from in_scope(item)

    def inspect_scope(body, outer, parameters=(), *, module_scope=False):
        nodes = [item for statement in body for item in in_scope(statement)]
        aliases = {name: set(values) for name, values in outer.items()}
        local = set(parameters)
        explicit = {}
        assignments = []
        outer_names = {name for node in nodes if isinstance(node, (ast.Global, ast.Nonlocal))
                       for name in node.names}
        for node in nodes:
            if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
                local.add(node.id)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                local.add(node.name)
            elif isinstance(node, ast.Import):
                for item in node.names:
                    name = item.asname or item.name.split(".")[0]
                    local.add(name)
                    target = item.name if item.asname else item.name.split(".")[0]
                    if target in bindings:
                        explicit.setdefault(name, set()).add(target)
            elif isinstance(node, ast.ImportFrom):
                for item in node.names:
                    name = item.asname or item.name
                    local.add(name)
                    target = f"{node.module}.{item.name}"
                    if node.level == 0 and target in bindings:
                        explicit.setdefault(name, set()).add(target)
            elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.NamedExpr)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                assignments.extend((target.id, node.value) for target in targets
                                   if isinstance(target, ast.Name))
            elif isinstance(node, ast.ExceptHandler) and node.name:
                local.add(node.name)
        for name in local - outer_names:
            # A later module assignment cannot erase an earlier reachable
            # builtin call. Function-local Store instead shadows throughout.
            if not module_scope:
                aliases.pop(name, None)
        for name, values in explicit.items():
            aliases.setdefault(name, set()).update(values)
        changed = True
        while changed:
            changed = False
            for name, value in assignments:
                resolved = reference(value, aliases)
                previous = aliases.setdefault(name, set())
                if not resolved <= previous:
                    previous.update(resolved)
                    changed = True
        for node in nodes:
            if isinstance(node, ast.Call):
                for loader in reference(node.func, aliases) & loaders:
                    inspect_call(node, loader)
            elif isinstance(node, comprehensions):
                parameters = {item.id for generator in node.generators
                              for item in ast.walk(generator.target)
                              if isinstance(item, ast.Name)}
                values = [node.key, node.value] if isinstance(node, ast.DictComp) else [node.elt]
                body = [*values, *(item for generator in node.generators for item in generator.ifs),
                        *(generator.iter for generator in node.generators[1:])]
                inspect_scope(body, aliases, parameters)
            elif isinstance(node, scopes):
                if isinstance(node, ast.ClassDef):
                    inspect_scope(node.body, aliases, module_scope=True)
                else:
                    args = node.args
                    parameters = [item.arg for item in
                                  [*args.posonlyargs, *args.args, *args.kwonlyargs,
                                   args.vararg, args.kwarg] if item]
                    inspect_scope([node.body] if isinstance(node, ast.Lambda) else node.body,
                                  aliases, parameters)

    inspect_scope(tree.body, {"__import__": {"builtins.__import__"}}, module_scope=True)
    return imports


def _dependency_cycles(graph: dict[str, set[str]]) -> list[list[str]]:
    """Tarjan SCCs: static cycles, including self edges, in deterministic order."""
    indices, low, stack, active, result = {}, {}, [], set(), []

    def visit(node):
        indices[node] = low[node] = len(indices)
        stack.append(node)
        active.add(node)
        for target in sorted(graph.get(node, set())):
            if target not in indices:
                visit(target)
                low[node] = min(low[node], low[target])
            elif target in active:
                low[node] = min(low[node], indices[target])
        if low[node] == indices[node]:
            component = []
            while True:
                target = stack.pop()
                active.remove(target)
                component.append(target)
                if target == node:
                    break
            if len(component) > 1 or node in graph.get(node, set()):
                result.append(sorted(component))

    for node in sorted(graph):
        if node not in indices:
            visit(node)
    return sorted(result)


def _import_details(
    path: Path,
    package_root: Path = PACKAGE_ROOT,
) -> tuple[set[str], list[tuple[str, set[str]]], set[str]]:
    source_module, source_is_package = _source_module(path, package_root)
    tree = ast.parse(path.read_text())
    imports: set[str] = _dynamic_imports(tree, package_root)
    from_imports: list[tuple[str, set[str]]] = []
    plain_imports: set[str] = _dynamic_imports(tree, package_root)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported = {alias.name for alias in node.names}
            imports.update(imported)
            plain_imports.update(imported)
            continue
        if not isinstance(node, ast.ImportFrom):
            continue
        resolved = _resolve_from_import(
            source_module=source_module,
            source_is_package=source_is_package,
            imported_module=node.module,
            level=node.level,
        )
        imports.add(resolved)
        symbols = {alias.name for alias in node.names}
        from_imports.append((resolved, symbols))
        for symbol in symbols:
            possible_child = f"{resolved}.{symbol}"
            if symbol != "*" and (
                _is_local_module(possible_child, package_root)
                or _matches_prefix(possible_child, CONCRETE_PROVIDER_PREFIXES)
            ):
                imports.add(possible_child)
    return imports, from_imports, plain_imports


def _matches_prefix(module_name: str, prefixes: tuple[str, ...]) -> bool:
    return any(
        module_name == prefix or module_name.startswith(f"{prefix}.")
        for prefix in prefixes
    )


def _module_layout_violations(
    modules_root: Path,
    dependency_graph: dict[str, set[str]] = ALLOWED_MODULE_DEPENDENCIES,
) -> list[str]:
    discovered = {
        path.name
        for path in modules_root.iterdir()
        if path.is_dir() and path.name != "__pycache__"
    }
    registered = set(dependency_graph)
    violations = [
        f"{name} is not registered" for name in sorted(discovered - registered)
    ]
    violations.extend(
        f"{name} is registered without a directory"
        for name in sorted(registered - discovered)
    )
    violations.extend(
        f"{name} has no public __init__.py"
        for name in sorted(discovered)
        if not (modules_root / name / "__init__.py").is_file()
    )
    violations.extend(
        f"{source} names unregistered dependency {target}"
        for source, targets in dependency_graph.items()
        for target in sorted(targets - registered)
    )
    violations.extend(
        f"{path.name} is a single-file business module"
        for path in modules_root.glob("*.py")
        if path.name != "__init__.py"
    )
    violations.extend(
        f"{relative} is registered as flat but does not exist"
        for relative in sorted(REGISTERED_FLAT_MODULE_FILES)
        if not (modules_root / relative).is_file()
    )
    return violations


def _architecture_violations(
    package_root: Path = PACKAGE_ROOT,
) -> list[str]:
    modules_root = package_root / "modules"
    root_entry = package_root / "__init__.py"
    violations: set[str] = set()
    module_graph: dict[str, set[str]] = {}

    for source_path in package_root.rglob("*.py"):
        imports, from_imports, plain_imports = _import_details(
            source_path, package_root
        )
        relative = source_path.relative_to(package_root)
        relative_label = relative.as_posix()
        if "<unresolved dynamic import>" in imports:
            violations.add(
                f"{relative_label}: unresolved dynamic import needs an explicit boundary"
            )

        if source_path == root_entry:
            for imported in imports:
                if imported.startswith("qunxue_api."):
                    violations.add(
                        f"{relative_label} cannot import internal layer {imported}"
                    )
            continue

        source_component = (
            relative.parts[0] if len(relative.parts) > 1 else relative.stem
        )
        if source_component not in ALLOWED_TOP_LEVEL_DEPENDENCIES:
            violations.add(f"{relative_label} is not a registered top-level component")
            continue
        for imported in imports:
            if not imported.startswith("qunxue_api."):
                continue
            target_component = imported.split(".")[1]
            if target_component not in ALLOWED_TOP_LEVEL_DEPENDENCIES[source_component]:
                violations.add(
                    f"{relative_label}: {source_component} cannot depend on "
                    f"{target_component}"
                )

        if modules_root not in source_path.parents:
            for imported in imports:
                if (
                    imported.startswith(f"{MODULE_PACKAGE}.")
                    and len(imported.split(".")) != 3
                ):
                    violations.add(
                        f"{relative_label} bypasses a module public package root: {imported}"
                    )
            continue

        module_relative = source_path.relative_to(modules_root)
        module_relative_label = module_relative.as_posix()
        for imported in imports:
            if _matches_prefix(imported, FORBIDDEN_BUSINESS_PREFIXES):
                violations.add(
                    f"{module_relative_label}: business module cannot import {imported}"
                )
        if len(module_relative.parts) < 2:
            continue
        source_module = module_relative.parts[0]
        module_graph.setdefault(source_module, set())
        for imported in imports:
            if not imported.startswith(f"{MODULE_PACKAGE}."):
                continue
            target_module = imported.split(".")[2]
            if target_module == source_module:
                continue
            module_graph[source_module].add(target_module)
            if target_module not in ALLOWED_MODULE_DEPENDENCIES.get(
                source_module, set()
            ):
                violations.add(
                    f"{module_relative_label}: {source_module} cannot depend on "
                    f"{target_module}"
                )
            if imported != f"{MODULE_PACKAGE}.{target_module}":
                violations.add(
                    f"{module_relative_label} bypasses {target_module}'s public package root"
                )

        for imported, symbols in from_imports:
            if imported == MODULE_PACKAGE:
                violations.add(
                    f"{module_relative_label} must import from a module public package root"
                )
                continue
            if not imported.startswith(f"{MODULE_PACKAGE}."):
                continue
            target_module = imported.split(".")[2]
            if target_module == source_module:
                continue
            allowed_symbols = ALLOWED_CROSS_MODULE_SYMBOLS.get(
                (source_module, target_module),
                set(),
            )
            unexpected = symbols - allowed_symbols
            if unexpected:
                violations.add(
                    f"{module_relative_label} cannot import {sorted(unexpected)} "
                    f"from {target_module}"
                )

        for imported in plain_imports:
            if not imported.startswith(f"{MODULE_PACKAGE}."):
                continue
            target_module = imported.split(".")[2]
            if target_module != source_module:
                violations.add(
                    f"{module_relative_label} must explicitly import symbols "
                    f"from {target_module}"
                )

        source_role = MODULE_INTERNAL_ROLE_ALIASES.get(
            Path(module_relative.parts[1]).stem,
            Path(module_relative.parts[1]).stem,
        )
        if source_role not in ALLOWED_MODULE_INTERNAL_DEPENDENCIES:
            if (module_relative.parts != (source_module, "__init__.py")
                    and module_relative_label not in REGISTERED_FLAT_MODULE_FILES):
                violations.add(f"{module_relative_label} has no internal role declaration")
            continue
        module_root = f"{MODULE_PACKAGE}.{source_module}"
        for imported in imports:
            if imported == module_root:
                violations.add(
                    f"{module_relative_label}: {source_role} cannot import "
                    "its module package root"
                )
                continue
            if not imported.startswith(f"{module_root}."):
                continue
            target_role = MODULE_INTERNAL_ROLE_ALIASES.get(
                imported.split(".")[3],
                imported.split(".")[3],
            )
            if (
                target_role
                not in ALLOWED_MODULE_INTERNAL_DEPENDENCIES[source_role]
            ):
                violations.add(
                    f"{module_relative_label}: {source_role} cannot depend on {target_role}"
                )

    violations.update(
        "business module dependency cycle (SCC): " + ", ".join(component)
        for component in _dependency_cycles(module_graph)
    )
    return sorted(violations)


def test_backend_obeys_registered_architecture() -> None:
    assert not _module_layout_violations(MODULES_ROOT)
    assert not _architecture_violations(PACKAGE_ROOT)


def test_research_method_is_registered_as_a_dependency_free_module() -> None:
    assert ALLOWED_MODULE_DEPENDENCIES["research_method"] == set()


def test_sqlite_repository_implements_the_public_research_intake_port() -> None:
    assert research_intake.ResearchTaskRepository is ResearchTaskRepository
    assert issubclass(SqliteResearchTaskRepository, ResearchTaskRepository)
    for method_name in ("get", "add_or_get_by_idempotency_key"):
        assert method_name in SqliteResearchTaskRepository.__dict__
        assert signature(
            SqliteResearchTaskRepository.__dict__[method_name]
        ) == signature(ResearchTaskRepository.__dict__[method_name])


def test_real_source_tree_exercises_negative_guards(tmp_path: Path) -> None:
    package_root = tmp_path / "qunxue_api"
    sources = {
        "__init__.py": "from .application import ResearchJourney\n",
        "application/__init__.py": "",
        "application/use_case.py": (
            "from qunxue_api.modules.research_intake.domain import ResearchTask\n"
        ),
        "bootstrap.py": "",
        "settings.py": "from .bootstrap import create_app\n",
        "modules/__init__.py": "",
        "modules/rogue.py": "",
        "modules/knowledge_catalog/domain.py": "",
        "modules/unregistered/__init__.py": "",
        "modules/research_intake/__init__.py": "",
        "modules/research_intake/domain.py": (
            "from ...application import ResearchJourney\n"
            "from .ports import ResearchTaskRepository\n"
            "from qunxue_api.modules.research_intake import ResearchTask\n"
        ),
        "modules/research_intake/ports.py": (
            "from .service import ResearchTaskService\n"
        ),
        "modules/research_intake/service.py": "",
    }
    for relative, source in sources.items():
        target = package_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source)

    layout_violations = _module_layout_violations(package_root / "modules")
    architecture_violations = _architecture_violations(package_root)

    for expected in (
        "unregistered is not registered",
        "knowledge_catalog has no public __init__.py",
        "rogue.py is a single-file business module",
    ):
        assert expected in layout_violations
    for expected in (
        "__init__.py cannot import internal layer qunxue_api.application",
        "modules/research_intake/domain.py: modules cannot depend on application",
        "domain cannot depend on ports",
        "domain cannot import its module package root",
        "ports cannot depend on service",
        "application/use_case.py bypasses a module public package root",
        "settings.py: settings cannot depend on bootstrap",
    ):
        assert any(
            expected in violation for violation in architecture_violations
        ), expected


def test_unclassified_business_file_cannot_be_an_unchecked_middle_layer(tmp_path: Path) -> None:
    root = tmp_path / "qunxue_api"
    target = root / "modules/research_intake/utility.py"
    target.parent.mkdir(parents=True)
    target.write_text("from .service import ResearchTaskService\n")
    (target.parent / "service.py").write_text("")
    assert any("utility.py has no internal role declaration" in violation
               for violation in _architecture_violations(root))


def test_dynamic_imports_obey_the_same_business_boundary(tmp_path: Path) -> None:
    root = tmp_path / "qunxue_api"
    target = root / "modules/research_intake/domain.py"
    target.parent.mkdir(parents=True)
    target.write_text(
        "import importlib as loader\n"
        "from importlib import import_module as load\n"
        "loader.import_module('sqlalchemy')\n"
        "load('fastapi')\n"
        "__import__('openai')\n"
        "load(selected_plugin)\n"
    )
    violations = _architecture_violations(root)
    for expected in (
        "business module cannot import sqlalchemy", "business module cannot import fastapi",
        "business module cannot import openai", "unresolved dynamic import",
    ):
        assert any(expected in violation for violation in violations), expected


def test_dependency_cycles_include_transitive_edges_and_ignore_acyclic_leaves() -> None:
    assert _dependency_cycles({"a": {"b"}, "b": {"c"}, "c": {"a", "leaf"}, "leaf": set()}) == [
        ["a", "b", "c"],
    ]
    assert _dependency_cycles({"a": {"b"}, "b": set()}) == []
    assert _dependency_cycles({"a": {"a"}}) == [["a"]]


def test_deleted_flat_registration_is_reported(tmp_path: Path) -> None:
    root = tmp_path / "modules"
    root.mkdir()
    violations = _module_layout_violations(root, {})
    assert "agent_conversation/context.py is registered as flat but does not exist" in violations


def test_literal_loader_aliases_and_fromlist_cannot_hide_business_dependencies(
    tmp_path: Path,
) -> None:
    root = tmp_path / "qunxue_api"
    target = root / "modules/research_intake/domain.py"
    target.parent.mkdir(parents=True)
    target.write_text(
        "import importlib as modules\n"
        "import builtins as built\n"
        "from builtins import __import__ as load_builtin\n"
        "load = modules.import_module\n"
        "second = load\n"
        "second(name='sqlalchemy')\n"
        "load_builtin('fastapi')\n"
        "built.__import__('openai')\n"
        "__import__('google', fromlist=['genai'])\n"
        "def function():\n"
        "    local = modules.import_module\n"
        "    return local('anthropic')\n"
    )
    violations = _architecture_violations(root)
    for package in ("sqlalchemy", "fastapi", "openai", "google.genai", "anthropic"):
        assert any(f"business module cannot import {package}" in item for item in violations)


def test_literal_loader_keyword_stdlib_and_shadowed_local_are_not_false_positives() -> None:
    assert _dynamic_imports(ast.parse(
        "import importlib\nimportlib.import_module(name='json')\n"
        "def transform(importlib):\n"
        "    return importlib.import_module('sqlalchemy')\n"
    )) == {"json"}
    assert _dynamic_imports(ast.parse(
        "def transform(importlib):\n"
        "    return importlib.import_module('sqlalchemy')\n"
    )) == set()
    assert _dynamic_imports(ast.parse(
        "import builtins\nload = builtins.__import__\nload('google', fromlist=selected)\n"
    )) == {"google", "<unresolved dynamic import>"}


def test_nested_unknown_initializer_and_business_root_do_not_bypass_roles(tmp_path: Path) -> None:
    root = tmp_path / "qunxue_api"
    sources = {
        "modules/__init__.py": "import sqlalchemy\n",
        "modules/research_intake/__init__.py": "from .utility import helper\n",
        "modules/research_intake/utility/__init__.py": "from ..service import helper\n",
        "modules/research_intake/service.py": "def helper(): pass\n",
    }
    for relative, source in sources.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source)
    violations = _architecture_violations(root)
    assert "__init__.py: business module cannot import sqlalchemy" in violations
    assert "research_intake/utility/__init__.py has no internal role declaration" in violations
    assert not any("research_intake/__init__.py has no internal role" in v for v in violations)


def test_loader_aliases_join_branches_and_deferred_global_bindings() -> None:
    assert _dynamic_imports(ast.parse(
        "def delayed():\n"
        "    return importlib.import_module('sqlalchemy')\n"
        "import importlib\n"
        "delayed()\n"
    )) == {"sqlalchemy"}
    assert _dynamic_imports(ast.parse(
        "import importlib\n"
        "if selected:\n"
        "    load = importlib.import_module\n"
        "else:\n"
        "    load = ordinary_function\n"
        "load('sqlalchemy')\n"
    )) == {"sqlalchemy"}


def test_dynamic_fromlist_preserves_public_attributes_instead_of_inventing_submodules(
    tmp_path: Path,
) -> None:
    root = tmp_path / "qunxue_api"
    for relative, source in {
        "application/use_case.py": (
            "__import__('qunxue_api.modules.identity', fromlist=['AccountRole'])\n"
        ),
        "modules/identity/__init__.py": "class AccountRole: pass\n",
    }.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source)
    assert _architecture_violations(root) == []


def test_later_module_binding_or_comprehension_cannot_erase_builtin_import() -> None:
    for suffix in (
        "__import__ = ordinary_function\n",
        "[__import__ for __import__ in callbacks]\n",
    ):
        assert _dynamic_imports(ast.parse("__import__('sqlalchemy')\n" + suffix)) == {"sqlalchemy"}
    assert _dynamic_imports(ast.parse(
        "def run(callbacks):\n"
        "    [__import__ for __import__ in callbacks]\n"
        "    return __import__('sqlalchemy')\n"
    )) == {"sqlalchemy"}
    assert _dynamic_imports(ast.parse(
        "def run(__import__):\n"
        "    return __import__('ordinary_local_name')\n"
    )) == set()
