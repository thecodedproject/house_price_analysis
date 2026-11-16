import { Link, useParams } from 'react-router-dom';
import { PROPERTY_TYPE_LABELS } from '../../shared/types';
import { PhotoGallery } from '../components/photo_gallery';
import { useDb } from '../data_context';
import { formatAddress, formatPrice } from '../format';

export function PropertyPage(): JSX.Element {
  const { id = '' } = useParams();
  const { db } = useDb();
  const property = db.properties[id];

  if (!property) {
    return (
      <p>
        No property <code>{id}</code>. <Link to="/">Back to properties</Link>
      </p>
    );
  }

  const sales = db.salesFor(id);
  const listings = db.listingsFor(id);

  return (
    <section className="propertyPage">
      <p>
        <Link to="/">← Properties</Link>
      </p>
      <h2>
        {formatAddress(property)}, {property.postcode}
      </h2>
      <dl className="facts">
        <dt>ID</dt>
        <dd>
          <code>{property.id}</code>
        </dd>
        <dt>Type</dt>
        <dd>{property.propertyType ? PROPERTY_TYPE_LABELS[property.propertyType] : '-'}</dd>
        <dt>Tenure</dt>
        <dd>{property.tenure === 'F' ? 'Freehold' : property.tenure === 'L' ? 'Leasehold' : '-'}</dd>
        <dt>Area</dt>
        <dd>{[property.locality, property.town, property.district].filter(Boolean).join(', ') || '-'}</dd>
        <dt>UPRN</dt>
        <dd>{property.uprn ?? '-'}</dd>
        {property.zooplaUrl && (
          <>
            <dt>Zoopla</dt>
            <dd>
              <a href={property.zooplaUrl} target="_blank" rel="noreferrer">
                property page
              </a>
            </dd>
          </>
        )}
      </dl>

      <h3>Sales ({sales.length})</h3>
      {sales.length === 0 && <p className="muted">None recorded.</p>}
      <ul className="timeline">
        {sales.map((s) => (
          <li key={s.id} className={s.supersededBy ? 'superseded' : undefined}>
            <span className="date">{s.date}</span>
            <strong>{formatPrice(s.price)}</strong>
            <span className={`badge ${s.status}`}>{s.status}</span>
            {s.ppdCategory === 'B' && <span className="badge">PPD B</span>}
            {s.newBuild && <span className="badge">new build</span>}
            {s.supersededBy && <span className="muted">superseded by {s.supersededBy}</span>}
          </li>
        ))}
      </ul>

      <h3>Listings ({listings.length})</h3>
      {listings.length === 0 && <p className="muted">None recorded - run yarn scrape:zoopla.</p>}
      {listings.map((l) => (
        <article key={l.id} className="listing">
          <header>
            <span className="date">{l.listedDate}</span>
            <strong>{formatPrice(l.price)}</strong>
            {l.listingType === 'rent' && <span className="badge">rent</span>}
            {l.event && <span className="muted">{l.event}</span>}
            {l.previousListingId && <span className="muted">↳ follows {l.previousListingId.split('_').slice(-2).join(' ')}</span>}
          </header>
          <p className="specs">
            {[
              l.bedrooms !== undefined && `${l.bedrooms} bed`,
              l.bathrooms !== undefined && `${l.bathrooms} bath`,
              l.receptions !== undefined && `${l.receptions} reception`,
              l.floorAreaSqm !== undefined && `${l.floorAreaSqm} m²`,
              l.condition && `condition: ${l.condition}`,
            ]
              .filter(Boolean)
              .join(' · ')}
            {l.zooplaListingUrl && (
              <>
                {' '}
                <a href={l.zooplaListingUrl} target="_blank" rel="noreferrer">
                  listing ↗
                </a>
              </>
            )}
          </p>
          {(l.title || l.status || l.agent || l.epcRating || l.tags?.length) && (
            <p className="specs muted">
              {[l.title, l.status, l.agent, l.epcRating && `EPC ${l.epcRating}`, ...(l.tags ?? [])].filter(Boolean).join(' · ')}
            </p>
          )}
          {l.description && <p className="description">{l.description}</p>}
          {l.features && l.features.length > 0 && (
            <ul className="features">
              {l.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          <PhotoGallery paths={l.images} />
          {l.floorplans && l.floorplans.length > 0 && (
            <>
              <h4>Floor plan{l.floorplans.length > 1 ? 's' : ''}</h4>
              <PhotoGallery paths={l.floorplans} />
            </>
          )}
        </article>
      ))}
    </section>
  );
}
