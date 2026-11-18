// The project windows, mounted once: Project settings, the configuration file viewer and Export
// portable project. They open from the Manage project menu, Results and Data setup.

import { Show, type JSX } from 'solid-js';
import { openProject } from '../../lib/open-project.ts';
import { configViewer, exportOpen, projectSettings } from '../../lib/project-dialogs.ts';
import { ConfigViewer } from './ConfigViewer.tsx';
import { ExportProject } from './ExportProject.tsx';
import { ProjectSettings } from './ProjectSettings.tsx';

export function ProjectWindows(): JSX.Element {
  return (
    <Show when={openProject()}>
      <Show when={projectSettings()}>
        <ProjectSettings />
      </Show>
      <Show when={configViewer()}>
        <ConfigViewer />
      </Show>
      <Show when={exportOpen()}>
        <ExportProject />
      </Show>
    </Show>
  );
}
