import json

from marketing_fox.agent import MarketingFoxAgent


def main() -> None:
    agent = MarketingFoxAgent()
    print(
        json.dumps(
            {
                "event": "agent_summary",
                "description": agent.describe(),
                "platform_summaries": list(agent.platform_summaries()),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
