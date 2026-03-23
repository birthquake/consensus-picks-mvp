// FILE LOCATION: src/pages/Halftime.jsx
// Halftime Picks — surfaces live halftime games and recommends rated prop legs
// based on first-half performance + recent form trends.
// 🚧 Under construction — placeholder renders while we build the backend.

export default function Halftime() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '60px 24px',
      gap: '16px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '48px' }}>🏀</div>
      <h2 style={{
        fontSize: '22px',
        fontWeight: '800',
        color: 'var(--text-primary)',
        margin: 0,
      }}>
        Halftime Picks
      </h2>
      <p style={{
        fontSize: '14px',
        color: 'var(--text-secondary)',
        maxWidth: '300px',
        lineHeight: '1.6',
        margin: 0,
      }}>
        Coming soon — real-time halftime prop recommendations built from live box scores and recent player trends.
      </p>
    </div>
  );
}
