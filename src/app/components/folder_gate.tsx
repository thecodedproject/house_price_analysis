import { ReactNode } from 'react';
import { useData } from '../data_context';

/** Renders children only once a data folder is loaded; otherwise the relevant prompt. */
export function FolderGate({ children }: { children: ReactNode }): JSX.Element {
  const { state, pickFolder, regrant } = useData();

  switch (state.status) {
    case 'ready':
      return <>{children}</>;
    case 'unsupported':
      return (
        <div className="notice">
          <h2>Unsupported browser</h2>
          <p>
            This app reads your scraped data straight from a folder on your computer using the File System
            Access API, which is only available in Chromium browsers (Chrome, Edge, Opera, Arc).
          </p>
        </div>
      );
    case 'checking':
    case 'loading':
      return <p className="notice">Loading…</p>;
    case 'needs-permission':
      return (
        <div className="notice">
          <p>
            Allow access to <code>{state.handle.name}</code> again to continue.
          </p>
          <button type="button" className="primary" onClick={regrant}>
            Grant access
          </button>{' '}
          <button type="button" onClick={pickFolder}>
            Pick a different folder
          </button>
        </div>
      );
    case 'error':
    case 'no-folder':
      return (
        <div className="notice">
          {state.status === 'error' && <p className="error">{state.message}</p>}
          <p>
            Open the project's <code>data/</code> folder (created by <code>yarn scrape:lr</code> /{' '}
            <code>yarn scrape:zoopla</code>).
          </p>
          <button type="button" className="primary" onClick={pickFolder}>
            Open data folder
          </button>
        </div>
      );
  }
}
