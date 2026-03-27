from __future__ import annotations

import re
from html import escape
from typing import Callable

from .models import DraftArtifact, PlatformId, PublishIntent


def generate_draft(intent: PublishIntent) -> DraftArtifact:
    platform_generators: dict[PlatformId, Callable[[PublishIntent], DraftArtifact]] = {
        "xiaohongshu": _generate_xiaohongshu_draft,
        "wechat_official_account": _generate_wechat_draft,
        "x": _generate_x_draft,
    }
    return platform_generators[intent.platform](intent)


def _extract_keywords(source_idea: str) -> list[str]:
    normalized = re.sub(r"[^\w\u4e00-\u9fff\s#]+", " ", source_idea, flags=re.UNICODE)
    tokens = [token.strip("#") for token in normalized.split() if token.strip("#")]
    keywords: list[str] = []
    for token in tokens:
        lowered = token.lower()
        if lowered not in {item.lower() for item in keywords}:
            keywords.append(token)
        if len(keywords) >= 5:
            break
    return keywords or ["灵感"]


def _condense_title(source_idea: str, limit: int) -> str:
    source_idea = re.sub(r"\s+", " ", source_idea).strip()
    if len(source_idea) <= limit:
        return source_idea
    return f"{source_idea[: limit - 1].rstrip()}…"


def _generate_xiaohongshu_draft(intent: PublishIntent) -> DraftArtifact:
    keywords = _extract_keywords(intent.source_idea)
    title = _condense_title(intent.source_idea, 20)
    tag_list = [f"#{keyword}" for keyword in keywords[:4]]
    preserve_option = intent.options.get("preserve_source_text")
    preserve_source_text = intent.mode != "prepare" if preserve_option is None else bool(preserve_option)
    if preserve_source_text:
        return DraftArtifact(
            platform="xiaohongshu",
            title=title,
            body=intent.source_idea.strip(),
            tags=tag_list,
            cover_hint=f"用大字突出“{keywords[0]}”，副标题保留古诗的安静氛围。",
            image_prompt=f"Create a clean Xiaohongshu-style cover about {keywords[0]} with quiet, poetic typography.",
            metadata={"source_keywords": keywords, "preserve_source_text": True},
        )

    body_lines = [
        f"今天想分享一个关于“{keywords[0]}”的小想法。",
        f"核心观点：{intent.source_idea.strip()}。",
        "如果你也在做内容增长，可以先从一个明确场景、一个具体动作、一个可验证结果开始写。",
        "想要我继续把这个想法拆成封面、正文结构和评论区引导，也可以继续展开。",
    ]
    return DraftArtifact(
        platform="xiaohongshu",
        title=title,
        body="\n\n".join(body_lines),
        tags=tag_list,
        cover_hint=f"用大字突出“{keywords[0]}”，副标题强调可执行步骤。",
        image_prompt=f"Create a clean Xiaohongshu-style cover about {keywords[0]} with bold typography and practical notes.",
        metadata={"source_keywords": keywords},
    )


def _generate_wechat_draft(intent: PublishIntent) -> DraftArtifact:
    keywords = _extract_keywords(intent.source_idea)
    title = _condense_title(intent.source_idea, 28)
    digest = f"围绕“{keywords[0]}”展开的一篇可直接发布的公众号短文草稿。"
    body_paragraphs = [
        f"<p>这次想讲一个很短但很有操作性的主题：{escape(intent.source_idea)}。</p>",
        "<p>如果你正在做内容运营，最容易卡住的不是想法不够，而是没有把想法整理成读者能马上理解的结构。</p>",
        f"<p>所以这篇内容的重点只有一个：先抓住“{escape(keywords[0])}”，再用一个具体场景把它讲清楚。</p>",
        "<p>你可以继续把这个方向扩展成案例、步骤清单、踩坑总结，甚至做成系列文章。</p>",
    ]
    return DraftArtifact(
        platform="wechat_official_account",
        title=title,
        digest=digest,
        author="marketing_fox",
        content_html="".join(body_paragraphs),
        metadata={"source_keywords": keywords},
    )


def _generate_x_draft(intent: PublishIntent) -> DraftArtifact:
    text = intent.source_idea.strip()
    if len(text) > 260:
        text = _condense_title(text, 260)
    keywords = _extract_keywords(text)
    if keywords:
        hashtag = f" #{keywords[0].replace(' ', '')}"
        if len(text) + len(hashtag) <= 280:
            text = f"{text}{hashtag}"
    return DraftArtifact(
        platform="x",
        text=text,
        metadata={"character_count": len(text)},
    )
