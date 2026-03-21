from marketing_fox.agent import MarketingFoxAgent


def main() -> None:
    agent = MarketingFoxAgent()
    print(agent.describe())
    for summary in agent.platform_summaries():
        print(f"- {summary}")


if __name__ == "__main__":
    main()
