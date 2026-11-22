import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/layout";
import Home from "./pages/home";
import Repositories from "./pages/repositories";
import Architecture from "./pages/architecture";
import History from "./pages/history";
import Source from "./pages/source";
import Search from "./pages/search";
import Stories from "./pages/stories";
import NotFound from "./pages/notfound";

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/repositories" element={<Repositories />} />
          <Route path="/architecture" element={<Architecture />} />
          <Route path="/history" element={<History />} />
          <Route path="/source" element={<Source />} />
          <Route path="/search" element={<Search />} />
          <Route path="/stories" element={<Stories />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
