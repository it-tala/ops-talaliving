"use client";

import { Loaded, useLoad } from "@/components/ui/loaded";
import { TaskRoadmap } from "@/components/hr/task-roadmap";
import { hr } from "@/demo/api";
import type { TaskView } from "@/services/hr/contracts";

/** The Roadmap tab: the board's tasks on a timeline (D382). Goals are read
 *  with the closed ones too, so a finished part still sits under its goal
 *  rather than falling into *Tanpa sasaran*. */
export function RoadmapPanel({ tasks, stamp }: { tasks: TaskView[]; stamp: unknown }) {
  const [goals, reloadGoals] = useLoad(() => hr.listGoals({ include_closed: true }), [stamp]);
  const [backlog] = useLoad(() => hr.listBacklog(), [stamp]);
  return (
    <Loaded state={goals} onRetry={reloadGoals}>
      {(g) => <TaskRoadmap tasks={tasks} goals={g} backlog={backlog.status === "ready" ? backlog.data : []} />}
    </Loaded>
  );
}
