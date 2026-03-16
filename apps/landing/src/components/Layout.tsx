import { Outlet } from "react-router";

import Banner from "./Banner";
import Footer from "./Footer";
import NavBar from "../Navbar";

export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Banner />
      <NavBar />
      <div className="flex-1">
        <Outlet />
      </div>
      <Footer />
    </div>
  );
}
