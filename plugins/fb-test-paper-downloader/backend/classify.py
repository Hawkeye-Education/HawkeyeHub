"""What a post's text says it is: its Level and Subject (its folder), and whether it is a paper.

Ported from fb_papers.py, with its known misses fixed. Staff re-file anything it gets wrong by hand.
"""

import re
from typing import Literal

# "未分級" (no Level) and "其他" (no Subject) are folders staff see, not sentinels.
Level = Literal["P1", "P2", "P3", "P4", "P5", "P6", "未分級"]
Subject = Literal["綜合", "中文", "英文", "數學", "常識", "科學", "人文", "普通話", "其他"]

_DIGIT: dict[str, Level] = {
    "1": "P1", "2": "P2", "3": "P3", "4": "P4", "5": "P5", "6": "P6",
    "一": "P1", "二": "P2", "三": "P3", "四": "P4", "五": "P5", "六": "P6",
}  # fmt: skip

_LEVELS = [
    re.compile(r"(?<![a-z])p\.?\s*([1-6])(?![0-9])", re.I),  # P2, P.4, #P3, p3
    re.compile(r"primary\s*([1-6])(?![0-9])", re.I),
    re.compile(r"小\s*([一二三四五六1-6])(?![0-9])"),  # 小三
    re.compile(r"([一二三四五六1-6])\s*年[級级]"),  # 三年級, 一年级
]

# On a tie the earlier entry wins, so 綜合's "中英數" beats the bare 英 and 數 below.
_SUBJECTS: list[tuple[Subject, re.Pattern[str]]] = [
    ("綜合", re.compile(r"中英數常|中英數|全科|各科")),
    # "Chi", "Chin", or "Chin" run into the next word ("P1_ChinTest")
    (
        "中文",
        re.compile(
            r"中文|中國語文|中國語|chinese|(?<![a-z])chin?(?![a-z])|(?-i:Chin(?=[A-Z]))", re.I
        ),
    ),
    # a bare 英 ("英 中閱"), "Eng" run into the next word ("P.1_EngTest"), and Reading & Writing
    (
        "英文",
        re.compile(
            r"英|english|(?<![a-z])eng(?![a-z])|(?-i:Eng(?=[A-Z]))|reading\s*&\s*writing", re.I
        ),
    ),
    ("數學", re.compile(r"[數数]|maths?(?![a-z])|mathematics", re.I)),  # a bare 數 ("小一數")
    ("常識", re.compile(r"常識|常识|general\s*studies|(?<![a-z])gs(?![a-z])", re.I)),
    ("科學", re.compile(r"科學|science", re.I)),
    ("人文", re.compile(r"人文|humanities", re.I)),
    ("普通話", re.compile(r"普通話|普通话|putonghua|(?<![a-z])pth(?![a-z])", re.I)),
]

_WELCOME = re.compile(r"歡迎新成員|欢迎新成员|welcome\s+(our\s+)?new\s+members?", re.I)


def classify_level(text: str) -> Level:
    found: list[tuple[int, Level]] = [
        (m.start(), _DIGIT[m.group(1)]) for rx in _LEVELS if (m := rx.search(text))
    ]
    return min(found, key=lambda f: f[0])[1] if found else "未分級"


def classify_subject(text: str) -> Subject:
    found: list[tuple[int, Subject]] = [
        (m.start(), name) for name, rx in _SUBJECTS if (m := rx.search(text))
    ]
    return min(found, key=lambda f: f[0])[1] if found else "其他"


def is_not_paper(text: str, images: int) -> bool:
    """A welcome-new-member post, or a question ("有冇答案") with no Level, Subject or paper."""
    if _WELCOME.search(text):
        return True
    return classify_level(text) == "未分級" and classify_subject(text) == "其他" and images < 2


def post_title(text: str) -> str:
    """The post's first two lines, as a folder name of at most 60 characters."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return safe_name(re.sub(r"#(\w)", r"\1", " ".join(lines[:2])), 60)  # "#P2" -> "P2"


def safe_name(text: str, max_len: int) -> str:
    """`text` as a Windows file or folder name of at most `max_len` characters."""
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", text)
    name = re.sub(r"\s+", " ", name).strip().strip(".")
    return name[:max_len].strip() or "untitled"


def is_incomplete(saved: int, shown: int) -> bool:
    """Far fewer images were saved than the feed showed: Facebook cut the viewer short."""
    return shown >= 3 and saved * 2 < shown
