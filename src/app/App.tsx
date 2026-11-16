import { NavLink, Route, Routes } from 'react-router-dom';
import './App.css';
import { FolderGate } from './components/folder_gate';
import { useData } from './data_context';
import { ListingsPage } from './pages/listings_page';
import { PropertiesPage } from './pages/properties_page';
import { PropertyPage } from './pages/property_page';
import { SalesPage } from './pages/sales_page';

function FolderStatus(): JSX.Element | null {
  const { state, reload, close } = useData();
  if (state.status !== 'ready') return null;
  return (
    <div className="folderStatus">
      <span className="muted">
        📁 <code>{state.name}</code>
      </span>
      <button type="button" onClick={reload} title="Re-read the JSON files after a scrape">
        Reload
      </button>
      <button type="button" onClick={close}>
        Close
      </button>
    </div>
  );
}

export default function App(): JSX.Element {
  return (
    <>
      <header className="appHeader">
        <h1>House Price Analysis</h1>
        <nav>
          <NavLink to="/" end>
            Properties
          </NavLink>
          <NavLink to="/sales">Sales</NavLink>
          <NavLink to="/listings">Listings</NavLink>
        </nav>
        <FolderStatus />
      </header>
      <main className="appMain">
        <FolderGate>
          <Routes>
            <Route path="/" element={<PropertiesPage />} />
            <Route path="/property/:id" element={<PropertyPage />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/listings" element={<ListingsPage />} />
          </Routes>
        </FolderGate>
      </main>
    </>
  );
}
