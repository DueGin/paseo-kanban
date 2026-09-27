import test from "node:test";
import assert from "node:assert/strict";
import {
  KanbanBoardSchema,
  addTask,
  updateTask,
  advanceTaskToNextLane,
  buildAgentPrompt,
} from "../shared/kanban.ts";

const baseBoard = () =>
  KanbanBoardSchema.parse({
    lanes: [
      { id: "todo", title: "待规划" },
      { id: "doing", title: "执行中" },
      { id: "done", title: "已完成" },
    ],
    tasks: [
      {
        id: "t1",
        title: "任务一",
        laneId: "todo",
        projectId: null,
        description: "",
        subtasks: [],
      },
      {
        id: "t2",
        title: "任务二",
        laneId: "doing",
        projectId: null,
        description: "",
        subtasks: [],
      },
    ],
  });

const sampleLink = {
  agentId: "agent-1",
  workspaceId: "ws-1",
  workspaceTitle: "任务一",
  provider: "codex/gpt-5",
  target: "worktree",
  startedAt: "2026-09-27T08:00:00.000Z",
  advanced: false,
};

test("KanbanBoardSchema: legacy tasks without an agent link default to null", () => {
  const board = baseBoard();
  assert.equal(board.tasks[0].agent, null);
});

test("updateTask: agent link can be attached and cleared without touching other fields", () => {
  const linked = updateTask(baseBoard(), "t1", { agent: sampleLink });
  assert.deepEqual(linked.tasks[0].agent, sampleLink);
  assert.equal(linked.tasks[0].title, "任务一");
  assert.equal(linked.tasks[0].laneId, "todo");

  const cleared = updateTask(linked, "t1", { agent: null });
  assert.equal(cleared.tasks[0].agent, null);
  assert.equal(cleared.tasks[0].laneId, "todo");
});

test("advanceTaskToNextLane: moves the task to the end of the next lane", () => {
  const board = addTask(baseBoard(), {
    id: "t3",
    title: "任务三",
    laneId: "doing",
  });
  const next = advanceTaskToNextLane(board, "t1");
  assert.equal(next.tasks.find((t) => t.id === "t1").laneId, "doing");
  // Appended after the tasks already occupying the target lane.
  assert.deepEqual(
    next.tasks.filter((t) => t.laneId === "doing").map((t) => t.id),
    ["t2", "t3", "t1"],
  );
});

test("advanceTaskToNextLane: last lane is a no-op and keeps object identity", () => {
  const board = advanceTaskToNextLane(baseBoard(), "t2"); // doing → done
  const again = advanceTaskToNextLane(board, "t2"); // done: no next lane
  assert.equal(again, board);
});

test("advanceTaskToNextLane: markAgentAdvanced flips the flag even in the last lane", () => {
  const board = updateTask(baseBoard(), "t2", { agent: sampleLink });
  const advanced = advanceTaskToNextLane(
    advanceTaskToNextLane(board, "t2"),
    "t2",
    { markAgentAdvanced: true },
  );
  const task = advanced.tasks.find((t) => t.id === "t2");
  assert.equal(task.laneId, "done");
  assert.equal(task.agent.advanced, true);
});

test("advanceTaskToNextLane: already-advanced or agent-less tasks stay untouched", () => {
  const linked = updateTask(baseBoard(), "t1", {
    agent: { ...sampleLink, advanced: true },
  });
  // advanced already true: only the lane move applies, link object is kept.
  const moved = advanceTaskToNextLane(linked, "t1", {
    markAgentAdvanced: true,
  });
  const movedTask = moved.tasks.find((t) => t.id === "t1");
  assert.equal(movedTask.agent.advanced, true);
  assert.equal(movedTask.laneId, "doing");

  // No link at all: marking is a no-op but the move still applies.
  const plain = advanceTaskToNextLane(baseBoard(), "t1", {
    markAgentAdvanced: true,
  });
  const plainTask = plain.tasks.find((t) => t.id === "t1");
  assert.equal(plainTask.agent, null);
  assert.equal(plainTask.laneId, "doing");
});

test("advanceTaskToNextLane: rejects a missing task", () => {
  assert.throws(() => advanceTaskToNextLane(baseBoard(), "nope"), /not found/);
});

test("buildAgentPrompt: title only, no empty sections", () => {
  const board = baseBoard();
  const prompt = buildAgentPrompt(board.tasks[0]);
  assert.equal(prompt, "任务一");
});

test("buildAgentPrompt: description and subtask checklist with completion states", () => {
  let board = baseBoard();
  board = updateTask(board, "t1", {
    description: "  详细说明\n第二行  ",
    subtasks: [
      { id: "s1", title: "步骤一", completed: false },
      { id: "s2", title: "步骤二", completed: true },
    ],
  });
  const prompt = buildAgentPrompt(board.tasks[0]);
  assert.equal(
    prompt,
    "任务一\n\n详细说明\n第二行\n\nSubtasks:\n- [ ] 步骤一\n- [x] 步骤二",
  );
});
