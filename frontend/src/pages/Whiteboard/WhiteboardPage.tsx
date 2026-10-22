import { Whiteboard } from "@/features/whiteboard/Whiteboard";
import { useImmersiveLayout } from "@/store/useLayoutStore";

export function WhiteboardPage() {
    // The editor owns the whole viewport: the site's navbar and footer step aside.
    useImmersiveLayout();
    return <Whiteboard />;
}
