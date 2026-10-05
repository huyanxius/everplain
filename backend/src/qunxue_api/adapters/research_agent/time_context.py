from datetime import UTC, datetime


def current_time_instructions() -> str:
    """Fresh server reference time, not an inferred user location or news feed."""
    return (
        f"当前服务器时间：{datetime.now(UTC).isoformat(timespec='seconds')}（UTC）。"
        "这是本轮时间参考，不代表用户本地时区；今天/几点等以明确时区解释，"
        "需要用户当地时间时先确认时区。今日新闻等近期事实仍须检索核实。"
    )
