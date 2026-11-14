"""Advisor graph wiring with a scripted model (no Anthropic, Voyage or Atlas calls)."""
import json
from datetime import datetime

import mongomock
import pytest
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langgraph.checkpoint.memory import InMemorySaver

from app.advisor_graph import build_graph, thread_config
from app.client_financials import seed_client_financials
from app.knowledge_tools import KnowledgeBase, Session


class ScriptedModel(BaseChatModel):
    """Returns queued AIMessages in order and records what it was sent."""
    script: list = []
    seen: list = []

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools, **kw):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kw):
        self.seen.append(messages)
        return ChatResult(generations=[ChatGeneration(message=self.script.pop(0))])


class NoVectorStore:
    def similarity_search_with_score(self, *a, **k):
        raise AssertionError("not expected in this test")


@pytest.fixture
def kb_factory():
    db = mongomock.MongoClient().hackathon
    db.client_knowledge.insert_many([
        {"client_id": "C1", "doc_type": "client_snapshot", "section": "0", "visibility": "advisor",
         "text": "C1 Maya Chen · At a glance", "source_path": "ClientSnapshot/C1.md"},
        {"client_id": "C1", "doc_type": "client_snapshot", "section": "3", "visibility": "underwriter",
         "text": "C1 credit profile (restricted)", "source_path": "ClientSnapshot/C1.md"},
        {"client_id": "C1", "doc_type": "goal_preference", "section": "1", "visibility": "advisor",
         "text": "C1 goals summary", "source_path": "GoalPreferences/C1.md"},
        {"doc_type": "approval_policy", "status": "current", "bank": "TD",
         "product": "personal_line_of_credit", "policy_id": "TD-PLC-2026-09", "version": "2.4",
         "date": datetime(2026, 9, 1), "source_path": "ApprovalPolicy/TD_PLC_Approval.md",
         "policy": {"min_credit_score": 650, "min_annual_income": 35000, "max_tds": 0.44,
                    "unsecured": {"limit_formula": "0.40 * annual_income", "cap": 35000, "floor": 3000},
                    "auto_decline_if": ["credit_score < 600", "annual_income < 25000"]}},
    ])
    seed_client_financials(db)
    return lambda session: KnowledgeBase(session, NoVectorStore(), db.client_knowledge)


def test_tool_loop_context_and_checkpointed_history(kb_factory):
    session = Session("adv_daniel", "advisor", {"C1"})
    llm = ScriptedModel(script=[
        AIMessage(content="", tool_calls=[{"id": "t1", "name": "check_eligibility",
                                           "args": {"client_id": "C1", "product": "personal_line_of_credit",
                                                    "bank": "TD", "co_signer_available": False}}]),
        AIMessage(content="Maya does not qualify for an unsecured line on her own."),
        AIMessage(content="As I said, the line is declined without the co-signer."),
    ], seen=[])
    saver = InMemorySaver()
    graph = build_graph(session, "C1", llm=llm, kb=kb_factory(session), checkpointer=saver)
    cfg = thread_config(session, "C1", "conv1")

    out = graph.invoke({"messages": [("user", "Can Maya get a line of credit?")]}, cfg)
    tool_msg = next(m for m in out["messages"] if isinstance(m, ToolMessage))
    result = json.loads(tool_msg.content)[0]
    assert result["decision"] == "DECLINE" and "662" not in tool_msg.content

    system = llm.seen[0][0].content
    assert "At a glance" in system and "goals summary" in system
    assert "restricted" not in system                       # underwriter-only section never loaded

    # Same thread, new graph instance (as after a restart): history comes from the checkpointer.
    graph2 = build_graph(session, "C1", llm=llm, kb=kb_factory(session), checkpointer=saver)
    out2 = graph2.invoke({"messages": [("user", "And without a co-signer?")]}, cfg)
    assert len(out2["messages"]) == len(out["messages"]) + 2
    assert llm.seen[-1][1].content == "Can Maya get a line of credit?"   # earlier turn was replayed


def test_cannot_open_conversation_for_other_client(kb_factory):
    session = Session("adv_daniel", "advisor", {"C1"})
    with pytest.raises(PermissionError):
        build_graph(session, "C2", llm=ScriptedModel(), kb=kb_factory(session), checkpointer=InMemorySaver())


def test_thread_ids_are_namespaced_by_user_and_client():
    a = thread_config(Session("u1", "advisor", {"C1"}), "C1", "x")["configurable"]["thread_id"]
    b = thread_config(Session("u2", "advisor", {"C1"}), "C1", "x")["configurable"]["thread_id"]
    assert a != b and a.startswith("u1:C1:")
