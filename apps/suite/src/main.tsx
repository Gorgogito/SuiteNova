import { createRoot } from 'react-dom/client';
import { Hub } from './hub/Hub';
import './messages';
import { findModule } from './modules';
import { Playground } from './playground/Playground';
import { CalcApp } from './calc/CalcApp';
import { WriterApp } from './writer/WriterApp';
import { SlidesApp } from './slides/SlidesApp';
import { NotesApp } from './notes/NotesApp';
import { BaseApp } from './base/BaseApp';
import { MailApp } from './mail/MailApp';
import { PlanApp } from './plan/PlanApp';
import { FormsApp } from './forms/FormsApp';
import { DiagramApp } from './diagram/DiagramApp';
import { ModuleShell } from './shell/ModuleShell';
import './app.css';

function Root() {
  const app = new URLSearchParams(location.search).get('app');
  if (import.meta.env.DEV && app === 'playground') return <Playground />;
  const module = findModule(app);
  if (module?.id === 'calc') return <CalcApp module={module} />;
  if (module?.id === 'writer') return <WriterApp module={module} />;
  if (module?.id === 'slides') return <SlidesApp module={module} />;
  if (module?.id === 'notes') return <NotesApp module={module} />;
  if (module?.id === 'base') return <BaseApp module={module} />;
  if (module?.id === 'mail') return <MailApp module={module} />;
  if (module?.id === 'plan') return <PlanApp module={module} />;
  if (module?.id === 'forms') return <FormsApp module={module} />;
  if (module?.id === 'diagram') return <DiagramApp module={module} />;
  return module ? <ModuleShell module={module} /> : <Hub />;
}

createRoot(document.getElementById('root')!).render(<Root />);
