import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PROPERTY_TYPE_LABELS, Property } from '../../shared/types';
import { Column, DataTable } from '../components/data_table';
import { useDb } from '../data_context';
import { formatAddress, formatPrice } from '../format';

interface Row {
  property: Property;
  address: string;
  sales: number;
  listings: number;
  lastSaleDate?: string;
  lastSalePrice?: number;
}

export function PropertiesPage(): JSX.Element {
  const { db } = useDb();
  const [postcode, setPostcode] = useState('');
  const [search, setSearch] = useState('');

  const allRows = useMemo<Row[]>(
    () =>
      Object.values(db.properties).map((p) => {
        const sales = db.salesFor(p.id).filter((s) => !s.supersededBy);
        const last = sales[sales.length - 1];
        return {
          property: p,
          address: formatAddress(p),
          sales: sales.length,
          listings: db.listingsFor(p.id).length,
          lastSaleDate: last?.date,
          lastSalePrice: last?.price,
        };
      }),
    [db],
  );
  const postcodes = useMemo(() => [...new Set(allRows.map((r) => r.property.postcode))].sort(), [allRows]);
  const rows = allRows.filter(
    (r) =>
      (!postcode || r.property.postcode === postcode) &&
      (!search || r.address.toLowerCase().includes(search.toLowerCase())),
  );

  const columns: Column<Row>[] = [
    {
      key: 'address',
      header: 'Address',
      render: (r) => <Link to={`/property/${encodeURIComponent(r.property.id)}`}>{r.address}</Link>,
      // sort by street then house number
      sortValue: (r) => `${r.property.street} ${r.property.paon.padStart(6, '0')} ${r.property.saon ?? ''}`,
    },
    { key: 'postcode', header: 'Postcode', sortValue: (r) => r.property.postcode, render: (r) => r.property.postcode },
    {
      key: 'type',
      header: 'Type',
      sortValue: (r) => r.property.propertyType,
      render: (r) => (r.property.propertyType ? PROPERTY_TYPE_LABELS[r.property.propertyType] : ''),
    },
    { key: 'tenure', header: 'Tenure', sortValue: (r) => r.property.tenure, render: (r) => r.property.tenure ?? '' },
    { key: 'sales', header: 'Sales', align: 'right' },
    { key: 'listings', header: 'Listings', align: 'right' },
    { key: 'lastSaleDate', header: 'Last sale', render: (r) => r.lastSaleDate ?? '' },
    { key: 'lastSalePrice', header: 'Last price', align: 'right', render: (r) => formatPrice(r.lastSalePrice) },
    { key: 'uprn', header: 'Zoopla', sortValue: (r) => r.property.uprn, render: (r) => (r.property.uprn ? '✓' : '') },
  ];

  return (
    <section>
      <div className="toolbar">
        <h2>Properties ({rows.length})</h2>
        <select value={postcode} onChange={(e) => setPostcode(e.target.value)}>
          <option value="">All postcodes</option>
          {postcodes.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <input type="search" placeholder="Search address" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.property.id} />
    </section>
  );
}
