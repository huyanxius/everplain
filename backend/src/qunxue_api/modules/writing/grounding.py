"""Conservative lexical grounding aids, not a semantic equivalence classifier."""

import re
import unicodedata
from collections import Counter
from decimal import Decimal, InvalidOperation

# These patterns redact explicit contact identifiers, not every personal detail.
_CONTACTS = re.compile(
    r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}"
    r"|https?://[^\s<>\]\)。，；！？]+"
    r"|(?<![A-Za-z0-9])\+?\d[\d ()-]{5,}\d(?![A-Za-z0-9])"
    r"|(?:微信|WeChat|QQ|Telegram|电话|手机|邮箱)\s*[:：]\s*[A-Za-z0-9_.@+-]+",
    re.I,
)


def _normalize_contact(value):
    value = unicodedata.normalize("NFKC", value).casefold()
    if re.fullmatch(r"[+\d ()-]+", value):
        digits = re.sub(r"\D", "", value)
        if len(digits) == 13 and digits.startswith("86") and digits[2] == "1":
            digits = digits[2:]
        return "phone:" + digits
    return re.sub(r"\s+", "", value)


def _is_contact(value: str) -> bool:
    if re.fullmatch(r"[+\d ()-]+", value):
        digits = re.sub(r"\D", "", value)
        return 7 <= len(digits) <= 15 and not re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", value)
    return True


def contact_identifiers(text: str) -> set[str]:
    return {
        _normalize_contact(m.group()) for m in _CONTACTS.finditer(text) if _is_contact(m.group())
    }


def redact_style_contacts(text: str) -> str:
    return _CONTACTS.sub(
        lambda m: "[联系方式已省略]" if _is_contact(m.group()) else m.group(), text
    )


_TAGGED_HANDLE = re.compile(r"(?:微信|WeChat|QQ|Telegram)\s*[:：]\s*([A-Za-z0-9_.@+-]{3,})", re.I)


def sample_contact_leaks(
    original: str, candidate: str, samples: list[str], instruction: str
) -> bool:
    allowed_text = original + "\n" + instruction
    sample_contacts = set().union(*(contact_identifiers(text) for text in samples))
    if (contact_identifiers(candidate) & sample_contacts) - contact_identifiers(allowed_text):
        return True
    # A generator can omit the "微信：" label. Match known sample-only handles
    # as bounded tokens rather than requiring that label again in the output.
    for sample in samples:
        for match in _TAGGED_HANDLE.finditer(sample):
            pattern = r"(?<![A-Za-z0-9_.@+-])" + re.escape(match[1]) + r"(?![A-Za-z0-9_.@+-])"
            if re.search(pattern, candidate, re.I) and not re.search(pattern, allowed_text, re.I):
                return True
    return False


_DIGITS = {c: i for i, c in enumerate("零一二三四五六七八九")}
_DIGITS.update({"〇": 0, "两": 2})
_SMALL_UNITS = {"十": 10, "百": 100, "千": 1000}
_LARGE_UNITS = {"万": 10000, "亿": 100000000}
_CHINESE = "零〇一二两三四五六七八九十百千万亿点负"
_ARABIC = r"[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[eE][-+]?\d{1,4})?"

# Only exact, unambiguous conversions. Currency conversion and time/calendar
# conversion are deliberately excluded. Count classifiers retain their identity.
_UNITS = {
    "毫米": ("length_m", "0.001"),
    "mm": ("length_m", "0.001"),
    "厘米": ("length_m", "0.01"),
    "cm": ("length_m", "0.01"),
    "米": ("length_m", "1"),
    "m": ("length_m", "1"),
    "千米": ("length_m", "1000"),
    "公里": ("length_m", "1000"),
    "km": ("length_m", "1000"),
    "毫克": ("mass_g", "0.001"),
    "mg": ("mass_g", "0.001"),
    "克": ("mass_g", "1"),
    "g": ("mass_g", "1"),
    "千克": ("mass_g", "1000"),
    "公斤": ("mass_g", "1000"),
    "kg": ("mass_g", "1000"),
    "%": ("proportion", "0.01"),
    "％": ("proportion", "0.01"),
}
for _unit in ("份", "人", "名", "个", "项", "件", "次", "元", "美元", "年", "月", "日", "天"):
    _UNITS[_unit] = (_unit, "1")
_UNIT_PATTERN = "|".join(re.escape(u) for u in sorted(_UNITS, key=len, reverse=True))
_QUANTITIES = re.compile(
    rf"百分之(?P<percent>[{_CHINESE}]+|{_ARABIC})"
    rf"|(?<![A-Za-z0-9])(?P<arabic>{_ARABIC})\s*(?P<unit>{_UNIT_PATTERN})?(?![A-Za-z0-9])"
    rf"|(?P<chinese>[{_CHINESE}]+)\s*(?P<chinese_unit>{_UNIT_PATTERN})"
)


def _number(value: str) -> Decimal | None:
    try:
        return Decimal(value.replace(",", ""))
    except InvalidOperation:
        pass
    sign = -1 if value.startswith("负") else 1
    value = value.removeprefix("负")
    integer, _, fraction = value.partition("点")
    if any(c not in _DIGITS for c in fraction) or not integer:
        return None
    if all(c in _DIGITS for c in integer):
        whole = int("".join(str(_DIGITS[c]) for c in integer))
    else:
        total = section = digit = 0
        for c in integer:
            if c in _DIGITS:
                digit = _DIGITS[c]
            elif c in _SMALL_UNITS:
                section += (digit or 1) * _SMALL_UNITS[c]
                digit = 0
            elif c in _LARGE_UNITS:
                if c == "亿":
                    total = (total + section + digit) * _LARGE_UNITS[c]
                else:
                    total += (section + digit) * _LARGE_UNITS[c]
                section = digit = 0
            else:
                return None
        whole = total + section + digit
    suffix = "." + "".join(str(_DIGITS[c]) for c in fraction) if fraction else ""
    return Decimal(str(whole) + suffix) * sign


def quantities(text: str) -> Counter:
    """Normalize supported quantities without attributing them to entities/claims.

    Chinese numeral recognition requires a classifier/unit, avoiding common words
    such as 一定, 万一, 一般. This limited recognizer can still miss quantities.
    """
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"https?://[^\s)\]>]+|\[\^[^\]]+\]|\[@[^\]]+\]|\[\d+\]", "", text)
    # List/section ordinals describe formatting, not factual amounts.
    text = re.sub(r"(?m)^\s*(?:#{1,6}\s+)?\d+(?:\.\d+)*[.)、]?\s+", "", text)
    result = Counter()
    for match in _QUANTITIES.finditer(text):
        raw = match["percent"] or match["arabic"] or match["chinese"]
        number = _number(raw)
        if number is None or not number.is_finite():
            continue
        unit = "%" if match["percent"] else match["unit"] or match["chinese_unit"] or ""
        dimension, multiplier = _UNITS.get(unit, ("number", "1"))
        result[(dimension, str((number * Decimal(multiplier)).normalize()))] += 1
    return result
