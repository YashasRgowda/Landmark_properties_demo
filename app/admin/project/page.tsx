import { requireAdmin } from '@/lib/auth/require';
import { getProjectData } from '@/lib/project-data';
import { projectToForm } from '@/lib/project-validate';
import { ProjectEditor } from './project-editor';
import { PageHeader } from '@/components/app/page-header';

export const metadata = { title: 'Project details · Landmark Lead Desk' };
export const dynamic = 'force-dynamic';

export default async function AdminProjectPage() {
  await requireAdmin('/admin/project');
  const project = await getProjectData();

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={project.name}
        title="Project details"
        description="Everything Meera tells buyers — prices, plots, approvals, offers — comes from this page. Save, and her very next WhatsApp uses it."
      />
      <ProjectEditor initial={projectToForm(project)} />
    </div>
  );
}
