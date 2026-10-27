"""Level x Subject from a post's text, the non-paper skip rule, folder titles and short posts."""

import pytest
from classify import classify_level, classify_subject, is_incomplete, is_not_paper, post_title


@pytest.mark.parametrize(
    ("text", "level", "subject"),
    [
        # what the original script already got right
        ("#P3 中文 呈分試", "P3", "中文"),
        ("Primary 5 Maths exam", "P5", "數學"),
        ("小四 常識 練習", "P4", "常識"),
        ("三年級 中英數常 全年", "P3", "綜合"),
        # the known misses
        ("P.2_EngTest", "P2", "英文"),
        ("P3 Chin Test", "P3", "中文"),
        ("2022数学一年级上学期", "P1", "數學"),
        ("六年级 英语 期末", "P6", "英文"),
        ("小二數", "P2", "數學"),
        ("p5 21-22 英 中閱 中作", "P5", "英文"),
        ("P6 Reading & Writing", "P6", "英文"),
        ("P1_ChinTest", "P1", "中文"),
        ("小三英默書", "P3", "英文"),
        ("P4數 卷", "P4", "數學"),
        # the spec's own examples, word for word
        ("P.1_EngTest", "P1", "英文"),
        ("P1 Chin Test", "P1", "中文"),
        ("一年级", "P1", "其他"),
        ("六年级", "P6", "其他"),
        ("小一數", "P1", "數學"),
        ("英 中閱", "未分級", "英文"),
        ("Reading & Writing", "未分級", "英文"),
        # nothing to go on
        ("請問有冇答案", "未分級", "其他"),
    ],
)
def test_classifies_level_and_subject(text: str, level: str, subject: str) -> None:
    assert (classify_level(text), classify_subject(text)) == (level, subject)


@pytest.mark.parametrize(
    ("text", "subject"),
    [
        # 數 and 英 inside another word are not the subject
        ("分數比較", "其他"),
        ("數量", "其他"),
        ("數字遊戲", "其他"),
        ("英華小學", "其他"),
        ("英皇書院 小六 中文", "中文"),
    ],
)
def test_a_bare_subject_character_inside_another_word_is_not_the_subject(
    text: str, subject: str
) -> None:
    assert classify_subject(text) == subject


def test_the_earliest_mention_wins() -> None:
    assert classify_subject("Maths and English") == "數學"
    assert classify_level("P4 revision, from 小五 book") == "P4"


def test_secondary_levels_are_not_primary() -> None:
    assert classify_level("S.2 Maths (2023-2024)") == "未分級"


@pytest.mark.parametrize(
    ("text", "images"),
    [
        ("讓我們熱烈歡迎新成員! Chan Tai Man,", 5),
        ("让我们热烈欢迎新成员!", 0),
        ("有冇答案", 1),
        ("想要答案", 0),
    ],
)
def test_non_papers_are_skipped(text: str, images: int) -> None:
    assert is_not_paper(text, images)


@pytest.mark.parametrize(
    ("text", "images"),
    [
        ("Term 2 Exam", 2),  # no Level or Subject, but enough images to be a paper
        ("P1", 1),
        ("數學", 1),
    ],
)
def test_papers_are_kept(text: str, images: int) -> None:
    assert not is_not_paper(text, images)


def test_post_title_is_the_first_two_lines_made_safe_for_a_folder() -> None:
    assert post_title("#P2 數學\n\n  上學期: 試卷/答案 \nmore text") == "P2 數學 上學期 試卷 答案"


def test_post_title_is_cut_to_60_characters() -> None:
    assert post_title("字" * 100) == "字" * 60


def test_post_title_of_nothing_usable_is_untitled() -> None:
    assert post_title(" ...\n") == "untitled"


@pytest.mark.parametrize(
    ("saved", "shown", "incomplete"),
    [
        (1, 4, True),  # under half of what the feed showed
        (2, 4, False),
        (1, 2, False),  # too few to judge
        (10, 10, False),
    ],
)
def test_is_incomplete_when_far_fewer_images_were_saved_than_shown(
    saved: int, shown: int, incomplete: bool
) -> None:
    assert is_incomplete(saved, shown) == incomplete
