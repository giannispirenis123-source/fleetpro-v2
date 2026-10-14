// 404 του δημόσιου site: ίδιο σε κάθε περίπτωση (άγνωστο slug, ανενεργή
// σελίδα, χωρίς publicSite) — δεν φανερώνει ποιο ισχύει, ούτε δείχνει προς το FleetPro.

export default function StorefrontNotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#fff", color: "#0f172a" }}>
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 44, fontWeight: 800, margin: 0 }}>404</p>
        <h1 style={{ fontSize: 20, margin: "8px 0" }}>Η σελίδα δεν βρέθηκε</h1>
        <p style={{ color: "#475569", margin: 0 }}>Page not found</p>
      </div>
    </main>
  );
}
