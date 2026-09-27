/**
 * Agent link badge and auto-advance watcher behavior via react-test-renderer.
 * The Paseo SDK is stubbed through moduleOverrides; native primitives are
 * test doubles.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  React,
  TestRenderer,
  act,
  loadClientComponent,
} from "./helpers/react-host-env.mjs";

// Pin the detected language before any client module evaluates its locale.
globalThis.i18n = { language: "zh-CN" };

function createFakePaseo(agent) {
  const listeners = new Set();
  const handle = {
    current: () => agent,
    refresh: async () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    handle,
    notify: () => listeners.forEach((listener) => listener()),
    paseo: { agents: { ref: () => handle } },
  };
}

const link = {
  agentId: "agent-1",
  workspaceId: "ws-1",
  workspaceTitle: "任务一",
  provider: "codex/gpt-5",
  target: "worktree",
  startedAt: "2026-09-27T08:00:00.000Z",
  advanced: false,
};

function collectText(root) {
  return root.root
    .findAllByType("Text")
    .map((node) => node.children.join(""))
    .join("|");
}

test("linked card shows a live status badge that opens the agent on press", async () => {
  const fake = createFakePaseo({
    status: "running",
    requiresAttention: false,
    updatedAt: "2026-09-27T09:00:00.000Z",
    archivedAt: null,
  });
  const KanbanCard = loadClientComponent("kanban-card", "KanbanCard", {
    "@getpaseo/plugin/client": { usePaseo: () => fake.paseo },
  });

  const opened = [];
  let root;
  await act(async () => {
    root = TestRenderer.create(
      React.createElement(KanbanCard, {
        task: {
          id: "t1",
          laneId: "lane",
          title: "任务一",
          subtasks: [],
          agent: link,
        },
        projectDisplayName: null,
        theme: { colors: {} },
        layout: { compact: false },
        binding: {
          isDragging: false,
          cardPanHandlers: {},
          handlePanHandlers: {},
        },
        onOpenAgent: (agentId) => opened.push(agentId),
      }),
    );
  });
  await act(async () => {});

  const text = collectText(root);
  assert.ok(text.includes("运行中"), `expected running badge in: ${text}`);
  assert.ok(!text.includes("为此任务启动 agent"));

  const badge = root.root.findByProps({
    accessibilityLabel: "查看关联的 agent",
  });
  act(() => badge.props.onPress());
  assert.deepEqual(opened, ["agent-1"]);

  // Live transition: the badge follows agent updates through the same handle.
  const goneAgent = null;
  fake.handle.current = () => goneAgent;
  act(() => fake.notify());
  await act(async () => {});
  assert.ok(collectText(root).includes("已关闭"));

  act(() => root.unmount());
});

test("unlinked card renders the start affordance and reports the task on press", async () => {
  const fake = createFakePaseo(null);
  const KanbanCard = loadClientComponent("kanban-card", "KanbanCard", {
    "@getpaseo/plugin/client": { usePaseo: () => fake.paseo },
  });

  const started = [];
  const task = { id: "t2", laneId: "lane", title: "任务二", subtasks: [] };
  let root;
  await act(async () => {
    root = TestRenderer.create(
      React.createElement(KanbanCard, {
        task,
        projectDisplayName: null,
        theme: { colors: {} },
        layout: { compact: false },
        binding: {
          isDragging: false,
          cardPanHandlers: {},
          handlePanHandlers: {},
        },
        onStartAgent: (selected) => started.push(selected.id),
      }),
    );
  });

  const play = root.root.findByProps({
    accessibilityLabel: "为此任务启动 agent",
  });
  act(() => play.props.onPress());
  assert.deepEqual(started, ["t2"]);

  act(() => root.unmount());
});

test("advance watcher fires exactly once when the linked agent finishes a turn", async () => {
  const agent = {
    status: "running",
    requiresAttention: false,
    updatedAt: "2026-09-27T09:00:00.000Z",
    archivedAt: null,
  };
  const fake = createFakePaseo(agent);
  const { AgentAdvanceWatcher } = loadClientComponent(
    "agent-advance-watcher",
    null,
    { "@getpaseo/plugin/client": { usePaseo: () => fake.paseo } },
  );

  const finished = [];
  const task = { id: "t1", agent: link };
  let root;
  await act(async () => {
    root = TestRenderer.create(
      React.createElement(AgentAdvanceWatcher, {
        task,
        onFinished: (taskId) => finished.push(taskId),
      }),
    );
  });
  await act(async () => {});
  assert.deepEqual(finished, []);

  // Turn completes: status flips to idle with activity after the start time.
  agent.status = "idle";
  agent.updatedAt = "2026-09-27T10:00:00.000Z";
  act(() => fake.notify());
  await act(async () => {});
  assert.deepEqual(finished, ["t1"]);

  // Re-render with the same link must not fire again; a new watcher that
  // observes the same finished agent fires for itself, but the board guards
  // idempotency through the persisted `advanced` flag.
  await act(async () => {
    root.update(
      React.createElement(AgentAdvanceWatcher, {
        task,
        onFinished: (taskId) => finished.push(taskId),
      }),
    );
  });
  assert.deepEqual(finished, ["t1"]);

  act(() => root.unmount());
});

test("advance watcher ignores agents that errored or finished before the link", async () => {
  const agent = {
    status: "error",
    requiresAttention: false,
    updatedAt: "2026-09-27T10:00:00.000Z",
    archivedAt: null,
  };
  const fake = createFakePaseo(agent);
  const { AgentAdvanceWatcher } = loadClientComponent(
    "agent-advance-watcher",
    null,
    { "@getpaseo/plugin/client": { usePaseo: () => fake.paseo } },
  );

  const finished = [];
  let root;
  await act(async () => {
    root = TestRenderer.create(
      React.createElement(AgentAdvanceWatcher, {
        task: { id: "t1", agent: link },
        onFinished: (taskId) => finished.push(taskId),
      }),
    );
  });
  await act(async () => {});
  assert.deepEqual(finished, []);

  // An idle agent whose last activity predates the link start is not a
  // completion of this run.
  agent.status = "idle";
  agent.updatedAt = "2026-09-27T07:00:00.000Z";
  act(() => fake.notify());
  await act(async () => {});
  assert.deepEqual(finished, []);

  act(() => root.unmount());
});
