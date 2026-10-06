"""Ordered capability composition for the Agent's public tool schema."""

from .evidence import (
    register_knowledge_read_tools,
    register_knowledge_search_tool,
    register_material_tools,
    register_web_tools,
)
from .memory import register_memory_tools
from .research import (
    register_analysis_tools,
    register_document_tools,
    register_research_map_tools,
    register_workflow_tools,
)
from .writing import register_writing_tools


def register_agent_tools(agent, runtime) -> None:
    """Keep model-visible names, schemas and order stable across capability splits."""
    register_memory_tools(agent, runtime)
    register_knowledge_search_tool(agent, runtime)
    register_web_tools(agent, runtime)
    register_material_tools(agent, runtime)
    register_analysis_tools(agent, runtime)
    register_knowledge_read_tools(agent, runtime)
    register_workflow_tools(agent, runtime)
    register_writing_tools(agent, runtime)
    register_document_tools(agent, runtime)
    register_research_map_tools(agent, runtime)
