import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projectData } from '@/lib/db/schema';
import { DEMO_ASHRAYA, type ProjectInfo } from './project-data-values';

export * from './project-data-values';

/** Read the live project data, seeding the demo values on first use. */
export async function getProjectData(): Promise<ProjectInfo> {
  const [row] = await db.select().from(projectData).where(eq(projectData.id, 1)).limit(1);
  if (row?.data) return row.data as ProjectInfo;

  await db
    .insert(projectData)
    .values({ id: 1, data: DEMO_ASHRAYA })
    .onConflictDoNothing({ target: projectData.id });

  return DEMO_ASHRAYA;
}

export async function saveProjectData(data: ProjectInfo): Promise<void> {
  await db
    .insert(projectData)
    .values({ id: 1, data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: projectData.id, set: { data, updatedAt: new Date() } });
}
