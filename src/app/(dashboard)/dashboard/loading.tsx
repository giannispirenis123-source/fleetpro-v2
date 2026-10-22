// Όσο φορτώνει μια σελίδα του dashboard (server components με ερωτήματα στη
// βάση): το sidebar μένει, στο κύριο μέρος μια ήσυχη ένδειξη αντί για «πάγωμα».
export default function DashboardLoading() {
  return (
    <div role="status" aria-live="polite" style={{ display: "grid", placeItems: "center", minHeight: "40vh" }}>
      <span
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: "3px solid rgba(79,70,229,0.2)",
          borderTopColor: "#4f46e5",
          animation: "fp-spin 0.8s linear infinite",
        }}
      />
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>…</span>
      <style>{"@keyframes fp-spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}
