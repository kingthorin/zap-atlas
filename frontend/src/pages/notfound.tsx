import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="p-10 text-center">
      <h1 className="text-3xl font-bold">Not found</h1>
      <p className="mt-2 text-slate-600">The requested Atlas page is not available.</p>
      <p className="mt-4">
        <Link to="/" className="text-indigo-600 hover:underline">Return to overview</Link>
      </p>
    </div>
  );
}
