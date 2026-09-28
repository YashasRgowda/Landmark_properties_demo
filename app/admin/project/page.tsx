import { requireAdmin } from '@/lib/auth/require';
import { getProjectData } from '@/lib/project-data';
import { projectToForm } from '@/lib/project-validate';
import { ProjectEditor } from './project-editor';

export const metadata = { title: 'Project data · Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminProjectPage() {
  await requireAdmin('/admin/project');
  const project = await getProjectData();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Project data</h1>
        <p className="text-muted-foreground text-sm">
          Everything Meera tells buyers comes from this page. Saving changes what she says on the
          very next message.
        </p>
      </div>
      <ProjectEditor initial={projectToForm(project)} />
    </div>
  );
}
