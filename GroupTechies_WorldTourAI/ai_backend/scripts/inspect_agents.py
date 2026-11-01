"""Print the registered agents for project evaluation."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from worldtour_ai.agents.registry import AGENTS


def main() -> None:
    for agent_cls in AGENTS:
        agent = agent_cls()
        print("=" * 60)
        print(f"Agent ID: {agent.agent_id}")
        print(f"Agent Name: {agent.agent_name}")
        print("Responsibilities:")
        for item in agent.responsibilities:
            print(f"  - {item}")
        print("Algorithms:")
        for item in agent.algorithms:
            print(f"  - {item}")
        print("Tools:")
        if agent.tools:
            for item in agent.tools:
                print(f"  - {item}")
        else:
            print("  - none")
        print(f"Provider: {agent.provider}")
        print(f"LLM Role: {agent.llm_role}")
        print()


if __name__ == "__main__":
    main()
