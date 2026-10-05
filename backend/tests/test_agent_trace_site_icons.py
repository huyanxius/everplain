from qunxue_api.adapters.research_agent.pydantic_runner import _trace_items


def test_web_result_trace_retains_existing_url_for_site_icons():
    url = "https://townscapergame.com/article?version=1"
    assert _trace_items([{"title": "Townscaper", "url": url, "source_kind": "web"}]) == [
        {"url": url, "source_kind": "web", "title": "Townscaper"}
    ]


def test_site_url_metadata_keeps_trace_limits_and_private_fields_excluded():
    items = _trace_items(
        [
            {"title": str(index), "url": "https://example.com/", "private": "excluded"}
            for index in range(8)
        ]
    )
    assert len(items) == 4
    assert all("private" not in item for item in items)
    assert _trace_items([{"title": "Knowledge"}]) == [{"title": "Knowledge"}]
