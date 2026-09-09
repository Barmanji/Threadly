import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSocket } from "../context/SocketContext";

interface WhiteboardProps {
  chatId?: string;
}

const Whiteboard: React.FC<WhiteboardProps> = ({ chatId }) => {
  const { socket } = useSocket();
  const [elements, setElements] = useState<ExcalidrawElement[]>([]);
  const [appState, setAppState] = useState<AppState | null>(null);
  const isRemoteUpdate = useRef(false);

  useEffect(() => {
    if (!socket || !chatId) return;

    // Join the chat room for whiteboard updates
    socket.emit("joinChat", chatId);

    const handleWhiteboardUpdate = (data: {
      elements?: ExcalidrawElement[];
      appState?: AppState;
    }) => {
      console.log("Whiteboard update received from socket:", data);
      if (data.elements || data.appState) {
        isRemoteUpdate.current = true;
        setElements(data.elements || []);
        setAppState(data.appState || null);
        isRemoteUpdate.current = false;
      }
    };

    socket.on("whiteboardUpdate", handleWhiteboardUpdate);

    return () => {
      socket.off("whiteboardUpdate", handleWhiteboardUpdate);
    };
  }, [socket, chatId]);

  const handleChange = useCallback(
    (
      newElements: readonly ExcalidrawElement[],
      newAppState: AppState,
    ) => {
      if (!socket || !chatId || isRemoteUpdate.current) return;

      setElements([...newElements]);
      setAppState(newAppState);

      socket.emit("whiteboardUpdate", {
        chatId,
        elements: Array.from(newElements),
        appState: newAppState,
      });
    },
    [socket, chatId],
  );

  return (
    <div className="h-full w-full">
      <Excalidraw
        theme="dark"
        onChange={handleChange}
        initialData={{
          elements: elements.length > 0 ? elements : undefined,
          appState: appState || undefined,
        }}
      />
    </div>
  );
};

export default Whiteboard;
