'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/require';
import { saveProjectData } from '@/lib/project-data';
import { checkProjectForm, type ProjectForm } from '@/lib/project-validate';

export type SaveProjectState = {
  errors?: string[];
  warnings?: string[];
  savedAt?: string;
  /** What was typed — so a failed save does not wipe the admin's edits. */
  values?: ProjectForm;
};

/**
 * Save the project data. Meera reads it fresh on every message, so this
 * changes what she tells buyers from the very next one.
 */
export async function saveProject(_prev: SaveProjectState, formData: FormData): Promise<SaveProjectState> {
  await requireAdmin('/admin/project');

  const values: ProjectForm = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') values[key] = value;
  }

  const result = checkProjectForm(values);
  if (!result.ok) return { errors: result.errors, warnings: result.warnings, values };

  await saveProjectData(result.data);
  revalidatePath('/admin/project');
  return { warnings: result.warnings, savedAt: new Date().toISOString(), values };
}
