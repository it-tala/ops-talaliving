"use client";

import { Loaded, useLoad } from "@/components/ui/loaded";
import { TaskRoadmap } from "@/components/hr/task-roadmap";
import { hr } from "@/demo/api";
import type { TaskView } from "@/services/hr/contracts";

/** The Roadmap tab: the board's tasks on a timeline (D382). Goals are read
 *  with the closed ones too, so a finished part still sits under its goal
 *  rather than falling into *Tanpa sasaran*. Candidates (D393) get a lane
 *  of their own at the bottom. */
export function RoadmapPanel({ tasks, stamp }: { tasks: TaskView[]; stamp: unknown }) {
  const [goals, reloadGoals] = useLoad(() => hr.listGoals({ include_closed: true }), [stamp]);
  const [backlog] = useLoad(() => hr.listBacklog(), [stamp]);
  /* Refused for a reader who may not see candidates: then there are none. */
  const [candidates] = useLoad(() => hr.listCandidateGoals(), [stamp]);
  return (
    <Loaded state={goals} onRetry={reloadGoals}>
      {(g) => <TaskRoadmap tasks={tasks} goals={g} backlog={backlog.status === "ready" ? backlog.data : []}
        candidates={candidates.status === "ready" ? candidates.data : []} />}
    </Loaded>
  );
}
