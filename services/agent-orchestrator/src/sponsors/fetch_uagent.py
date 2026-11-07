# File: services/agent-orchestrator/src/sponsors/fetch_uagent.py
import os
import sys
from datetime import UTC, datetime
from uuid import uuid4

# Allow `python services/agent-orchestrator/src/sponsors/fetch_uagent.py` from the repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sponsors.meta_muse import get_meta_client
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

agent = Agent(
    name="cobrowse_skill_agent",
    seed=os.environ.get("FETCH_AGENT_SEED", "cobrowse-hackathon-seed-phrase"),
    port=8001,
    mailbox=True,
)
chat_proto = Protocol(spec=chat_protocol_spec)


@chat_proto.on_message(ChatMessage)
async def handle_chat(ctx: Context, sender: str, msg: ChatMessage) -> None:
    await ctx.send(
        sender,
        ChatAcknowledgement(
            timestamp=datetime.now(UTC),
            acknowledged_msg_id=msg.msg_id,
        ),
    )
    user_text = " ".join(item.text for item in msg.content if isinstance(item, TextContent)).strip()
    if not user_text:
        return

    client = get_meta_client()
    completion = client.chat.completions.create(
        model="muse-spark-1.3",
        messages=[
            {
                "role": "system",
                "content": "You are the Fetch.ai Co-Browse Skill Coordinator powered by Meta Muse Spark 1.3.",
            },
            {"role": "user", "content": user_text},
        ],
    )
    reply_text = completion.choices[0].message.content or "Task queued for co-browsing."

    await ctx.send(
        sender,
        ChatMessage(
            timestamp=datetime.now(UTC),
            msg_id=uuid4(),
            content=[
                TextContent(type="text", text=reply_text),
                EndSessionContent(type="end-session"),
            ],
        ),
    )


@chat_proto.on_message(ChatAcknowledgement)
async def handle_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
    ctx.logger.info(f"ACP ack from {sender}: {msg.acknowledged_msg_id}")


agent.include(chat_proto, publish_manifest=True)

if __name__ == "__main__":
    print(f"Fetch.ai uAgent Address: {agent.address}")
    agent.run()
