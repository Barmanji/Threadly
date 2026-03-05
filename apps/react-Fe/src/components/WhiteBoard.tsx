import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { useRef } from "react";

function Whiteboard() {
  return (
    <>

<div className="h-100 w-100">
        <Excalidraw theme="dark"/>
      </div>
    </>
  );
}

export default Whiteboard;
