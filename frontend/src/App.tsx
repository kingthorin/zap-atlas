import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/layout";
import Home from "./pages/home";
import Repositories from "./pages/repositories";
import Architecture from "./pages/architecture";
import History from "./pages/history";
import Source from "./pages/source";
import Search from "./pages/search";
import Stories, { StoryDetail } from "./pages/stories";
import CommitPage from "./pages/commit";
import AddOnPage from "./pages/addon";
import ModulePage from "./pages/module";
import SymbolPage from "./pages/symbol";
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
          <Route path="/stories/:slug" element={<StoryDetail />} />
          <Route path="/commit/:repo/:sha" element={<CommitPage />} />
          <Route path="/addon/:id" element={<AddOnPage />} />
          <Route path="/module/:repo/*" element={<ModulePage />} />
          <Route path="/symbol/:id" element={<SymbolPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
