import { createRoot } from 'react-dom/client';
import { ClipOverlay } from './clip/ClipOverlay';
import { Hub } from './hub/Hub';
import './messages';
import { useEffect } from 'react';
import { prepareWindow, showWindow } from './desktop';
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
  if (app === 'clip-overlay') return <ClipOverlay />;
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

/** Shows the window once the frame has been drawn (the screen clip shows its own windows). */
function ShowWhenDrawn() {
  useEffect(() => {
    void showWindow().catch((e) => console.error('ventana:', e));
  }, []);
  return null;
}

const app = new URLSearchParams(location.search).get('app');
const render = () =>
  createRoot(document.getElementById('root')!).render(
    <>
      <Root />
      {app !== 'clip-overlay' && <ShowWhenDrawn />}
    </>,
  );

if (app === 'clip-overlay') render();
else
  void prepareWindow(findModule(app)?.id ?? 'hub')
    .catch((e) => console.error('ventana:', e))
    .finally(render);
