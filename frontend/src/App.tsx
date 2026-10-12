import { RouterProvider } from "react-aria-components";
import { useHref, useNavigate } from "react-router-dom";
import { SupportDialog } from "@/components/common/SupportDialog";
import { AppRoutes } from "@/routes/AppRoutes";

export default function App() {
    const navigate = useNavigate();

    // Lets Untitled UI (React Aria) links and buttons with `href` use client-side routing.
    return (
        <RouterProvider navigate={navigate} useHref={useHref}>
            <AppRoutes />
            <SupportDialog />
        </RouterProvider>
    );
}
