"""CI-only full migrated-schema classification gate. Never grants export access."""

from sqlalchemy import JSON, LargeBinary, inspect

from .account_export_contracts import EXCLUDED, EXPORTS
from .base import Base


def validate_export_schema(bind):
    inspector = inspect(bind)
    actual = set(inspector.get_table_names())
    declared = set(EXPORTS) | set(EXCLUDED)
    errors = []
    if actual != declared:
        errors.append(
            f"unclassified tables: {sorted(actual - declared)}; "
            f"stale tables: {sorted(declared - actual)}"
        )
    if set(EXPORTS) & set(EXCLUDED):
        errors.append("tables both exported and excluded")
    for name in sorted(actual & declared):
        columns = {column["name"]: column for column in inspector.get_columns(name)}
        if name in EXCLUDED:
            expected = set(EXCLUDED[name].columns)
            if not EXCLUDED[name].reason:
                errors.append(f"{name}: exclusion reason missing")
        else:
            contract = EXPORTS[name]
            excluded = dict(contract.omitted)
            expected = set(contract.fields) | set(excluded)
            if set(contract.fields) & set(excluded):
                errors.append(f"{name}: field both exported and excluded")
            if any(not reason for reason in excluded.values()):
                errors.append(f"{name}: exclusion reason missing")
            json_fields = {key for key, _ in contract.json_fields}
            actual_json = {
                key
                for key in contract.fields
                if key in columns and isinstance(columns[key]["type"], JSON)
            }
            if json_fields != actual_json:
                errors.append(f"{name}: JSON projection coverage mismatch")
            actual_binary = {
                key
                for key in contract.fields
                if key in columns and isinstance(columns[key]["type"], LargeBinary)
            }
            if set(contract.binary_fields) != actual_binary:
                errors.append(f"{name}: binary encoding coverage mismatch")
            if not set(contract.identity) <= set(contract.fields):
                errors.append(f"{name}: stable identity is not exported")
            if contract.owner and contract.owner not in columns:
                errors.append(f"{name}: owner column missing")
            for parent in contract.parents:
                if (
                    parent.column not in columns
                    or parent.table not in EXPORTS
                    or parent.key not in EXPORTS[parent.table].fields
                ):
                    errors.append(f"{name}: invalid ownership parent {parent}")
            # An owner-bearing model can never silently fall back to an FK route.
            direct_owner = next(
                (key for key in ("owner_user_id", "user_id") if key in columns), None
            )
            if direct_owner and contract.owner != direct_owner:
                errors.append(f"{name}: direct owner must be {direct_owner}")
        if set(columns) != expected:
            errors.append(
                f"{name}: unclassified columns {sorted(set(columns) - expected)}; "
                f"stale columns {sorted(expected - set(columns))}"
            )
    # ORM evolution also requires review, even before a migration is authored.
    for name, table in Base.metadata.tables.items():
        if name not in declared:
            errors.append(f"unclassified ORM table: {name}")
        elif name in actual and set(table.c.keys()) != {
            c["name"] for c in inspector.get_columns(name)
        }:
            errors.append(f"{name}: ORM and migrated schema differ")

    def visit(name, path):
        if name in path:
            errors.append(f"ownership cycle: {path + (name,)}")
            return
        contract = EXPORTS[name]
        if contract.owner or contract.audit_subject:
            return
        if not contract.parents:
            errors.append(f"{name}: missing ownership declaration")
        for parent in contract.parents:
            if parent.table in EXPORTS:
                visit(parent.table, path + (name,))

    for name in EXPORTS:
        visit(name, ())
    if errors:
        raise ValueError("Unreviewed account export schema:\n" + "\n".join(errors))
