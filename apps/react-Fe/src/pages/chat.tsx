import {
  DocumentIcon,
  EllipsisVerticalIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
  PlusIcon,
  XMarkIcon,
  VideoCameraIcon,
  PhoneIcon,
} from "@heroicons/react/20/solid";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import {
  deleteMessage,
  getChatMessages,
  getUserChats,
  sendMessage,
} from "../api";
import AddChatModal from "../components/chat/AddChatModal";
import ChatItem from "../components/chat/ChatItem";
import MessageItem from "../components/chat/MessageItem";
import Typing from "../components/chat/Typing";
import Input from "../components/Input";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { useWebRTC } from "../context/WebRTCContext";
import { useGroupCall } from "../context/GroupCallContext";
import CallModal from "../components/call/CallModal";
import IncomingCallModal from "../components/call/IncomingCallModal";
import GroupCallModal from "../components/call/GroupCallModal";
import GroupCallNotification from "../components/call/GroupCallNotification";
import type {
  ChatListItemInterface,
  ChatMessageInterface,
} from "../interfaces/chat";
import {
  LocalStorage,
  classNames,
  getChatObjectMetadata,
  getFileKind,
  requestHandler,
} from "../utils";

const CONNECTED_EVENT = "connected";
const DISCONNECT_EVENT = "disconnect";
const JOIN_CHAT_EVENT = "joinChat";
const NEW_CHAT_EVENT = "newChat";
const TYPING_EVENT = "typing";
const STOP_TYPING_EVENT = "stopTyping";
const MESSAGE_RECEIVED_EVENT = "messageReceived";
const LEAVE_CHAT_EVENT = "leaveChat";
const UPDATE_GROUP_NAME_EVENT = "updateGroupName";
const MESSAGE_DELETE_EVENT = "messageDeleted";
// const SOCKET_ERROR_EVENT = "socketError";

// Fallback label when a typing event arrives without sender details.
const isTypingGroupFallbackName = (isGroupChat?: boolean) =>
  isGroupChat ? "someone" : "";

const ChatPage = () => {
  // Import the 'useAuth' and 'useSocket' hooks from their respective contexts
  const { user, logout } = useAuth();
  const { socket } = useSocket();
  const { startCall } = useWebRTC();
  const { startGroupCall } = useGroupCall();
  // Create a reference using 'useRef' to hold the currently selected chat.
  // 'useRef' is used here because it ensures that the 'currentChat' value within socket event callbacks
  // will always refer to the latest value, even if the component re-renders.
  const currentChat = useRef<ChatListItemInterface | null>(null);

  // To keep track of the setTimeout function
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Per-user safety timers so the "typing" indicator disappears even if the
  // stop-typing event gets lost in transit. Keyed by `${chatId}:${userId}`.
  const typingUserTimeoutsRef = useRef<
    Record<string, NodeJS.Timeout | undefined>
  >({});

  // Define state variables and their initial values using 'useState'
  const [isConnected, setIsConnected] = useState(false); // For tracking socket connection

  const [openAddChat, setOpenAddChat] = useState(false); // To control the 'Add Chat' modal
  const [loadingChats, setLoadingChats] = useState(false); // To indicate loading of chats
  const [loadingMessages, setLoadingMessages] = useState(false); // To indicate loading of messages

  const [chats, setChats] = useState<ChatListItemInterface[]>([]); // To store user's chats
  const [messages, setMessages] = useState<ChatMessageInterface[]>([]); // To store chat messages
  const [unreadMessages, setUnreadMessages] = useState<ChatMessageInterface[]>(
    [],
  ); // To track unread messages

  // Map of chatId -> userId -> { _id, username } currently typing in that chat
  const [typingUsers, setTypingUsers] = useState<
    Record<string, Record<string, { _id: string; username: string }>>
  >({});
  const [selfTyping, setSelfTyping] = useState(false); // To track if the current user is typing

  const [message, setMessage] = useState(""); // To store the currently typed message
  const [localSearchQuery, setLocalSearchQuery] = useState(""); // For local search functionality

  const [attachedFiles, setAttachedFiles] = useState<File[]>([]); // To store files attached to messages

  /**
   *  A  function to update the last message of a specified chat to update the chat list
   */
  const updateChatLastMessage = (
    chatToUpdateId: string,
    message: ChatMessageInterface, // The new message to be set as the last message
  ) => {
    // Search for the chat with the given ID in the chats array
    const chatToUpdate = chats.find((chat) => chat._id === chatToUpdateId)!;

    // Update the 'lastMessage' field of the found chat with the new message
    chatToUpdate.lastMessage = message;

    // Update the 'updatedAt' field of the chat with the 'updatedAt' field from the message
    chatToUpdate.updatedAt = message?.updatedAt;

    // Update the state of chats, placing the updated chat at the beginning of the array
    setChats([
      chatToUpdate, // Place the updated chat first
      ...chats.filter((chat) => chat._id !== chatToUpdateId), // Include all other chats except the updated one
    ]);
  };
  /**
   *A function to update the chats last message specifically in case of deletion of message *
   **/

  const updateChatLastMessageOnDeletion = (
    chatToUpdateId: string, //ChatId to find the chat
    message: ChatMessageInterface, //The deleted message
  ) => {
    // Search for the chat with the given ID in the chats array
    const chatToUpdate = chats.find((chat) => chat._id === chatToUpdateId)!;

    //Updating the last message of chat only in case of deleted message and chats last message is same
    if (chatToUpdate.lastMessage?._id === message._id) {
      requestHandler(
        async () => getChatMessages(chatToUpdateId),
        null,
        (req) => {
          const { data } = req;

          chatToUpdate.lastMessage = data[0];
          setChats([...chats]);
        },
        (err) => toast.error(err),
      );
    }
  };

  const getChats = async () => {
    requestHandler(
      async () => await getUserChats(),
      setLoadingChats,
      (res) => {
        const { data } = res;
        setChats(data || []);
      },
      (err) => toast.error(err),
    );
  };

  const getMessages = async () => {
    // Check if a chat is selected, if not, show an alert
    if (!currentChat.current?._id) return toast.error("No chat is selected");

    // Check if socket is available, if not, show an alert
    if (!socket) return toast.error("Socket not available");

    // Emit an event to join the current chat
    socket.emit(JOIN_CHAT_EVENT, currentChat.current?._id);

    // Filter out unread messages from the current chat as those will be read
    setUnreadMessages(
      unreadMessages.filter((msg) => msg.chat !== currentChat.current?._id),
    );

    // Make an async request to fetch chat messages for the current chat
    requestHandler(
      // Fetching messages for the current chat
      async () => await getChatMessages(currentChat.current?._id || ""),
      // Set the state to loading while fetching the messages
      setLoadingMessages,
      // After fetching, set the chat messages to the state if available
      (res) => {
        const { data } = res;
        setMessages(data || []);
      },
      // Display any error alerts if they occur during the fetch
      (err) => toast.error(err),
    );
  };

  // Function to send a chat message
  const sendChatMessage = async () => {
    // If no current chat ID exists or there's no socket connection, exit the function
    if (!currentChat.current?._id || !socket || !isConnected) return;

    const chatId = currentChat.current?._id;
    const rawMessage = message;
    const rawFiles = attachedFiles;
    if (!rawMessage.trim() && rawFiles.length === 0) return;

    // Emit a STOP_TYPING_EVENT to inform other users/participants that typing has stopped
    socket.emit(STOP_TYPING_EVENT, {
      chatId,
      sender: { _id: user?._id, username: user?.username },
    });

    // Optimistically show a WhatsApp-style pending bubble so the user knows the
    // message is in transit and can keep typing/sending.
    const tempId = `temp-${Date.now()}`;
    const pendingMessage: ChatMessageInterface = {
      _id: tempId,
      sender: {
        _id: user?._id || "",
        avatar: user?.avatar || "",
        email: user?.email || "",
        username: user?.username || "",
      },
      content: rawMessage,
      chat: chatId,
      sending: true,
      attachments: rawFiles.map((file, i) => ({
        url: URL.createObjectURL(file),
        mimetype: file.type,
        fileName: file.name,
        size: file.size,
        _id: `${tempId}-${i}`,
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setMessages((prev) => [pendingMessage, ...prev]);
    setMessage("");
    setAttachedFiles([]);

    // Use the requestHandler to send the message and handle potential response or error
    await requestHandler(
      // Try to send the chat message with the given message and attached files
      async () => await sendMessage(chatId, rawMessage, rawFiles),
      null,
      // On successful message sending, replace the pending bubble with the real message
      (res) => {
        setMessages((prev) => [
          res.data,
          ...prev.filter((m) => m._id !== tempId),
        ]);
        updateChatLastMessage(chatId, res.data);
      },

      // If there's an error during the message sending process, remove the
      // pending bubble, restore the input, and raise an alert
      (err) => {
        setMessages((prev) => prev.filter((m) => m._id !== tempId));
        setMessage(rawMessage);
        setAttachedFiles(rawFiles);
        toast.error(err);
      },
    );
  };

  const deleteChatMessage = async (message: ChatMessageInterface) => {
    //ONClick delete the message and reload the chat when deleteMessage socket gives any response in chat.tsx
    //use request handler to prevent any errors

    await requestHandler(
      async () => await deleteMessage(message.chat, message._id),
      null,
      (res) => {
        setMessages((prev) => prev.filter((msg) => msg._id !== res.data._id));
        updateChatLastMessageOnDeletion(message.chat, message);
      },
      (err) => toast.error(err),
    );
  };

  const handleOnMessageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Update the message state with the current input value
    setMessage(e.target.value);

    // If socket doesn't exist or isn't connected, exit the function
    if (!socket?.connected) return;

    // Check if the user isn't already set as typing
    if (!selfTyping) {
      // Set the user as typing
      setSelfTyping(true);

      // Emit a typing event to the server for the current chat
      socket.emit(TYPING_EVENT, {
        chatId: currentChat.current?._id,
        sender: { _id: user?._id, username: user?.username },
      });
    }

    // Clear the previous timeout (if exists) to avoid multiple setTimeouts from running
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Define a length of time (in milliseconds) for the typing timeout
    const timerLength = 3000;

    // Set a timeout to stop the typing indication after the timerLength has passed
    typingTimeoutRef.current = setTimeout(() => {
      // Emit a stop typing event to the server for the current chat
      socket.emit(STOP_TYPING_EVENT, {
        chatId: currentChat.current?._id,
        sender: { _id: user?._id, username: user?.username },
      });

      // Reset the user's typing state
      setSelfTyping(false);
    }, timerLength);
  };

  const onConnect = () => {
    setIsConnected(true);
  };

  const onDisconnect = () => {
    setIsConnected(false);
  };

  /**
   * Handles the "typing" event on the socket.
   */
  const handleOnSocketTyping = (
    payload:
      | string
      | { chatId: string; sender?: { _id: string; username: string } },
  ) => {
    const chatId = typeof payload === "string" ? payload : payload?.chatId;
    // The typing event may target any chat (not just the active one),
    // so we always record it keyed by chatId.
    if (!chatId) return;

    const sender = typeof payload === "string" ? undefined : payload?.sender;
    const key = sender?._id || "unknown";
    const typingUser = sender ?? {
      _id: key,
      username: isTypingGroupFallbackName(
        chats.find((c) => c._id === chatId)?.isGroupChat,
      ),
    };

    // Add the sender to the set of people currently typing in that chat.
    setTypingUsers((prev) => ({
      ...prev,
      [chatId]: { ...prev[chatId], [key]: typingUser },
    }));

    // Safety: auto-hide the indicator if the stop-typing event is missed.
    const timerKey = `${chatId}:${key}`;
    if (typingUserTimeoutsRef.current[timerKey]) {
      clearTimeout(typingUserTimeoutsRef.current[timerKey]);
    }
    typingUserTimeoutsRef.current[timerKey] = setTimeout(() => {
      setTypingUsers((prev) => {
        const next = { ...prev };
        const perChat = { ...next[chatId] };
        delete perChat[key];
        if (Object.keys(perChat).length === 0) {
          delete next[chatId];
        } else {
          next[chatId] = perChat;
        }
        return next;
      });
      delete typingUserTimeoutsRef.current[timerKey];
    }, 5000);
  };

  /**
   * Handles the "stop typing" event on the socket.
   */
  const handleOnSocketStopTyping = (
    payload:
      | string
      | { chatId: string; sender?: { _id: string; username: string } },
  ) => {
    const chatId = typeof payload === "string" ? payload : payload?.chatId;
    if (!chatId) return;

    const sender = typeof payload === "string" ? undefined : payload?.sender;
    const key = sender?._id || "unknown";
    const timerKey = `${chatId}:${key}`;
    if (typingUserTimeoutsRef.current[timerKey]) {
      clearTimeout(typingUserTimeoutsRef.current[timerKey]);
      delete typingUserTimeoutsRef.current[timerKey];
    }

    // Remove the sender from the set of people currently typing in that chat.
    setTypingUsers((prev) => {
      const next = { ...prev };
      const perChat = { ...next[chatId] };
      delete perChat[key];
      if (Object.keys(perChat).length === 0) {
        delete next[chatId];
      } else {
        next[chatId] = perChat;
      }
      return next;
    });
  };

  const onMessageDelete = (message: ChatMessageInterface) => {
    if (message?.chat !== currentChat.current?._id) {
      setUnreadMessages((prev) =>
        prev.filter((msg) => msg._id !== message._id),
      );
    } else {
      setMessages((prev) => prev.filter((msg) => msg._id !== message._id));
    }

    updateChatLastMessageOnDeletion(message.chat, message);
  };

  /**
   * Handles the event when a new message is received.
   */
  const onMessageReceived = (message: ChatMessageInterface) => {
    // FIX: Debugging --------------------------
    console.log("📨 Socket message received:", message);

    // FIX: END ---------------------------------

    // The sender is no longer typing since they delivered a message
    const senderId = message.sender?._id;
    const chatId = message.chat;
    if (senderId && chatId) {
      // Clear that chat's typing indicator for this sender
      const timerKey = `${chatId}:${senderId}`;
      if (typingUserTimeoutsRef.current[timerKey]) {
        clearTimeout(typingUserTimeoutsRef.current[timerKey]);
        delete typingUserTimeoutsRef.current[timerKey];
      }
      setTypingUsers((prev) => {
        const next = { ...prev };
        const perChat = { ...next[chatId] };
        delete perChat[senderId];
        if (Object.keys(perChat).length === 0) {
          delete next[chatId];
        } else {
          next[chatId] = perChat;
        }
        return next;
      });
    }

    // Check if the received message belongs to the currently active chat
    if (message?.chat !== currentChat.current?._id) {
      // If not, update the list of unread messages
      setUnreadMessages((prev) => [message, ...prev]);
    } else {
      // If it belongs to the current chat, update the messages list for the active chat
      setMessages((prev) => [message, ...prev]);
    }

    // Update the last message for the chat to which the received message belongs
    updateChatLastMessage(message.chat || "", message);
  };

  const onNewChat = (chat: ChatListItemInterface) => {
    setChats((prev) => [chat, ...prev]);
  };

  // This function handles the event when a user leaves a chat.
  const onChatLeave = (chat: ChatListItemInterface) => {
    // Check if the chat the user is leaving is the current active chat.
    if (chat._id === currentChat.current?._id) {
      // If the user is in the group chat they're leaving, close the chat window.
      currentChat.current = null;
      // Remove the currentChat from local storage.
      LocalStorage.remove("currentChat");
    }
    // Update the chats by removing the chat that the user left.
    setChats((prev) => prev.filter((c) => c._id !== chat._id));
  };

  // Function to handle changes in group name
  const onGroupNameChange = (chat: ChatListItemInterface) => {
    // Check if the chat being changed is the currently active chat
    if (chat._id === currentChat.current?._id) {
      // Update the current chat with the new details
      currentChat.current = chat;

      // Save the updated chat details to local storage
      LocalStorage.set("currentChat", chat);
    }

    // Update the list of chats with the new chat details
    setChats((prev) => [
      // Map through the previous chats
      ...prev.map((c) => {
        // If the current chat in the map matches the chat being changed, return the updated chat
        if (c._id === chat._id) {
          return chat;
        }
        // Otherwise, return the chat as-is without any changes
        return c;
      }),
    ]);
  };

  useEffect(() => {
    // Fetch the chat list from the server.
    getChats();

    // Retrieve the current chat details from local storage.
    const _currentChat = LocalStorage.get("currentChat");

    // If there's a current chat saved in local storage:
    if (_currentChat) {
      // Set the current chat reference to the one from local storage.
      currentChat.current = _currentChat;
      // If the socket connection exists, emit an event to join the specific chat using its ID.
      socket?.emit(JOIN_CHAT_EVENT, _currentChat.current?._id);
      // Fetch the messages for the current chat.
      getMessages();
    }
    // An empty dependency array ensures this useEffect runs only once, similar to componentDidMount.
  }, []);

  // Clean up typing timers on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      Object.values(typingUserTimeoutsRef.current).forEach((t) => {
        if (t) clearTimeout(t);
      });
      typingUserTimeoutsRef.current = {};
    };
  }, []);

  // This useEffect handles the setting up and tearing down of socket event listeners.
  useEffect(() => {
    // If the socket isn't initialized, we don't set up listeners.

    if (!socket) return;

    // FIX: Debugging -------------------------------------------------------
    console.log("Socket initial state:", { socket: !!socket, isConnected });
    // Check if socket is already connected
    if (socket.connected) {
      console.log("Socket already connected, setting isConnected to true");
      setIsConnected(true);
    }
    if (!socket.connected) {
      console.log("Socket not connected, attempting to connect...");
      socket.connect();
    }
    socket.onAny((event, ...args) => {
      console.log("🔔 Socket event received:", event, args);
    });
    // FIX: ---------------------------------------------------------
    // Set up event listeners for various socket events:
    // Listener for when the socket connects.
    socket.on(CONNECTED_EVENT, onConnect);
    // Listener for when the socket disconnects.
    socket.on(DISCONNECT_EVENT, onDisconnect);
    // Listener for when a user is typing.
    socket.on(TYPING_EVENT, handleOnSocketTyping);
    // Listener for when a user stops typing.
    socket.on(STOP_TYPING_EVENT, handleOnSocketStopTyping);
    // Listener for when a new message is received.
    socket.on(MESSAGE_RECEIVED_EVENT, onMessageReceived);
    // Listener for the initiation of a new chat.
    socket.on(NEW_CHAT_EVENT, onNewChat);
    // Listener for when a user leaves a chat.
    socket.on(LEAVE_CHAT_EVENT, onChatLeave);
    // Listener for when a group's name is updated.
    socket.on(UPDATE_GROUP_NAME_EVENT, onGroupNameChange);
    //Listener for when a message is deleted
    socket.on(MESSAGE_DELETE_EVENT, onMessageDelete);
    // When the component using this hook unmounts or if `socket` or `chats` change:
    return () => {
      // Remove all the event listeners we set up to avoid memory leaks and unintended behaviors.
      socket.off(CONNECTED_EVENT, onConnect);
      socket.off(DISCONNECT_EVENT, onDisconnect);
      socket.off(TYPING_EVENT, handleOnSocketTyping);
      socket.off(STOP_TYPING_EVENT, handleOnSocketStopTyping);
      socket.off(MESSAGE_RECEIVED_EVENT, onMessageReceived);
      socket.off(NEW_CHAT_EVENT, onNewChat);
      socket.off(LEAVE_CHAT_EVENT, onChatLeave);
      socket.off(UPDATE_GROUP_NAME_EVENT, onGroupNameChange);
      socket.off(MESSAGE_DELETE_EVENT, onMessageDelete);
    };

    // Note:
    // The `chats` array is used in the `onMessageReceived` function.
    // We need the latest state value of `chats`. If we don't pass `chats` in the dependency array,
    // the `onMessageReceived` will consider the initial value of the `chats` array, which is empty.
    // This will not cause infinite renders because the functions in the socket are getting mounted and not executed.
    // So, even if some socket callbacks are updating the `chats` state, it's not
    // updating on each `useEffect` call but on each socket call.
  }, [socket, chats]);

  // Metadata for the current chat (used to display the remote user in the call UI)
  const currentChatMetadata = currentChat.current
    ? getChatObjectMetadata(currentChat.current, user!)
    : null;

  // Active chat's typing users
  const activeChatTyping = currentChat.current?._id
    ? typingUsers[currentChat.current._id] || {}
    : {};
  // List of distinct people typing in the active chat
  const typingUsersList = Object.values(activeChatTyping).filter(
    (t) => t._id && t._id !== user?._id,
  );
  const isTyping = typingUsersList.length > 0;
  // Label shown only in group chats, e.g. "John is typing" / "John and Sam are typing"
  let typingLabel: string | undefined;
  if (isTyping && currentChat.current?.isGroupChat) {
    if (typingUsersList.length === 1) {
      typingLabel = `${typingUsersList[0].username || "Someone"} is typing`;
    } else if (typingUsersList.length === 2) {
      typingLabel = `${typingUsersList[0].username || "Someone"} and ${
        typingUsersList[1].username || "Someone"
      } are typing`;
    } else {
      typingLabel = "multiple people are typing";
    }
  }

  // Helper to build the sidebar typing caption for a given chat
  const getChatTypingCaption = (chat: ChatListItemInterface): string | null => {
    const perChat = typingUsers[chat._id] || {};
    const list = Object.values(perChat).filter(
      (t) => t._id && t._id !== user?._id,
    );
    if (list.length === 0) return null;
    if (!chat.isGroupChat) return "is typing...";
    if (list.length === 1) return `${list[0]!.username || "Someone"} is typing...`;
    if (list.length === 2)
      return `${list[0]!.username || "Someone"} and ${
        list[1]!.username || "Someone"
      } are typing`;
    return "multiple people are typing";
  };

  // Resizable sidebar: width in px (defaults to ~1/3 of the viewport).
  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    typeof window !== "undefined" ? Math.round(window.innerWidth / 3) : 420,
  );

  // Handles the drag-to-resize gesture on the sidebar handle.
  const onSidebarDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.min(
        Math.max(startWidth + (moveEvent.clientX - startX), 240),
        window.innerWidth - 480,
      );
      setSidebarWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <>
      <AddChatModal
        open={openAddChat}
        onClose={() => {
          setOpenAddChat(false);
        }}
        onSuccess={() => {
          getChats();
        }}
      />

      <div className="w-full justify-between items-stretch h-screen flex flex-shrink-0 bg-cream overflow-hidden">
        <div
          className="relative overflow-y-auto flex-shrink-0 bg-cream"
          style={{ width: sidebarWidth }}
        >
          <div className="z-10 w-full sticky top-0 bg-cream border-b-4 border-ink p-4 flex flex-col justify-between items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex items-center justify-between gap-2 sm:justify-start">
              <button
                type="button"
                className="neo neo-press inline-flex h-12 flex-shrink-0 items-center justify-center whitespace-nowrap bg-retro-red px-4 text-xs font-extrabold uppercase tracking-wide text-paper focus:outline-none sm:h-14 sm:px-5 sm:text-sm"
                onClick={logout}
              >
                Log Out
              </button>

              <button
                onClick={() => setOpenAddChat(true)}
                className="neo neo-press inline-flex h-12 flex-shrink-0 items-center justify-center whitespace-nowrap bg-retro-yellow px-4 text-xs font-extrabold uppercase tracking-wide text-ink sm:h-14 sm:px-5 sm:text-sm"
              >
                <PlusIcon className="mr-1 h-4 w-4" aria-hidden="true" />
                Add chat
              </button>
            </div>
            <Input
              placeholder="Search user or group..."
              value={localSearchQuery}
              onChange={(e) =>
                setLocalSearchQuery(e.target.value.toLowerCase())
              }
              className="min-w-0 flex-1 sm:h-14"
            />
          </div>
          <div className="px-4">
            {loadingChats ? (
              <div className="flex justify-center items-center h-[calc(100%-88px)]">
                <Typing />
              </div>
            ) : (
              // Iterating over the chats array
              [...chats]
                // Filtering chats based on a local search query
                .filter((chat) =>
                  // If there's a localSearchQuery, filter chats that contain the query in their metadata title
                  localSearchQuery
                    ? getChatObjectMetadata(chat, user!)
                        .title?.toLocaleLowerCase()
                        ?.includes(localSearchQuery)
                    : // If there's no localSearchQuery, include all chats
                      true,
                )
                .map((chat) => {
                  return (
                    <ChatItem
                      chat={chat}
                      isActive={chat._id === currentChat.current?._id}
                      unreadCount={
                        unreadMessages.filter((n) => n.chat === chat._id).length
                      }
                      onClick={(chat) => {
                        if (
                          currentChat.current?._id &&
                          currentChat.current?._id === chat._id
                        )
                          return;
                        LocalStorage.set("currentChat", chat);
                        currentChat.current = chat;
                        setMessage("");
                        getMessages();
                      }}
                      key={chat._id}
                      typingCaption={getChatTypingCaption(chat)}
                      onChatDelete={(chatId) => {
                        setChats((prev) =>
                          prev.filter((chat) => chat._id !== chatId),
                        );
                        if (currentChat.current?._id === chatId) {
                          currentChat.current = null;
                          LocalStorage.remove("currentChat");
                        }
                      }}
                    />
                  );
                })
            )}
          </div>
        </div>
        {/* Drag handle to resize the sidebar — ink divider only, with a small centered grip */}
        <div
          onMouseDown={onSidebarDragStart}
          title="Drag to resize"
          className="relative z-30 w-1 flex-shrink-0 cursor-col-resize border-l-4 border-ink bg-cream"
        >
          <span className="pointer-events-none absolute top-1/2 flex h-7 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm border-2 border-ink bg-paper">
            <EllipsisVerticalIcon className="h-4 w-3.5 text-ink" />
          </span>
        </div>
        <div className="flex-1 flex flex-col min-h-0">
          {currentChat.current && currentChat.current?._id ? (
            <>
              <div className="p-4 bg-cream z-20 flex flex-shrink-0 justify-between items-center w-full border-b-4 border-ink">
                <div className="flex justify-start items-center w-max gap-3">
                  {currentChat.current.isGroupChat ? (
                    <div className="w-14 relative h-14 flex-shrink-0 flex justify-start items-center flex-nowrap">
                      {currentChat.current.participants
                        .slice(0, 3)
                        .map((participant, i) => {
                          return (
                            <img
                              key={participant._id}
                              src={participant.avatar}
                              className={classNames(
                                "w-9 h-9 border-[3px] border-ink rounded-sm absolute",
                                i === 0
                                  ? "left-0 z-30"
                                  : i === 1
                                    ? "left-2 z-20"
                                    : i === 2
                                      ? "left-4 z-10"
                                      : "",
                              )}
                            />
                          );
                        })}
                    </div>
                  ) : (
                    <img
                      className="h-14 w-14 flex-shrink-0 rounded-sm border-[3px] border-ink object-cover"
                      src={
                        getChatObjectMetadata(currentChat.current, user!).avatar
                      }
                    />
                  )}
                  <div>
                    <p className="font-extrabold uppercase tracking-wide text-ink">
                      {getChatObjectMetadata(currentChat.current, user!).title}
                    </p>
                    <small className="text-ink/60">
                      {
                        getChatObjectMetadata(currentChat.current, user!)
                          .description
                      }
                    </small>
                  </div>
                </div>
                {
                  <div className="flex items-center gap-2">
                    {currentChat.current?.isGroupChat ? (
                      <>
                        <button
                          onClick={() => {
                            const roomId = currentChat.current?._id;
                            const invitees =
                              currentChat.current?.participants.map(
                                (p) => p._id,
                              ) ?? [];
                            if (!roomId) return;
                            startGroupCall(roomId, "audio", invitees);
                            toast.info("Starting group audio call...");
                          }}
                          className="neo-sm neo-press rounded-sm bg-cream p-2 text-ink hover:bg-retro-yellow"
                        >
                          <PhoneIcon className="w-6 h-6" />
                        </button>
                        <button
                          onClick={() => {
                            const roomId = currentChat.current?._id;
                            const invitees =
                              currentChat.current?.participants.map(
                                (p) => p._id,
                              ) ?? [];
                            if (!roomId) return;
                            startGroupCall(roomId, "video", invitees);
                            toast.info("Starting group video call...");
                          }}
                          className="neo-sm neo-press rounded-sm bg-cream p-2 text-ink hover:bg-retro-yellow"
                        >
                          <VideoCameraIcon className="w-6 h-6" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            const recipient =
                              currentChat.current?.participants.find(
                                (p) => p._id !== user?._id,
                              );
                            if (recipient) {
                              startCall(recipient._id, "audio");
                              toast.info(`Calling ${recipient.username}...`);
                            }
                          }}
                          className="neo-sm neo-press rounded-sm bg-cream p-2 text-ink hover:bg-retro-yellow"
                        >
                          <PhoneIcon className="w-6 h-6" />
                        </button>
                        <button
                          onClick={() => {
                            const recipient =
                              currentChat.current?.participants.find(
                                (p) => p._id !== user?._id,
                              );
                            if (recipient) {
                              startCall(recipient._id, "video");
                              toast.info(`Calling ${recipient.username}...`);
                            }
                          }}
                          className="neo-sm neo-press rounded-sm bg-cream p-2 text-ink hover:bg-retro-yellow"
                        >
                          <VideoCameraIcon className="w-6 h-6" />
                        </button>
                      </>
                    )}
                  </div>
                }
              </div>
              <CallModal
                chatId={currentChat.current?._id}
                remoteAvatar={currentChatMetadata?.avatar}
                remoteName={currentChatMetadata?.title}
                localAvatar={user?.avatar}
              />
              <GroupCallModal chatId={currentChat.current?._id} />
              <GroupCallNotification />
              <IncomingCallModal />
              <div className="relative w-full flex-1 min-h-0">
                <div
                  className={classNames(
                    "bg-doodle p-8 overflow-y-auto flex flex-col-reverse gap-6 w-full h-full",
                  )}
                  id="message-window"
                >
                  {loadingMessages ? (
                    <div className="flex justify-center items-center h-full">
                      <Typing />
                    </div>
                  ) : (
                    <>
                      {messages?.map((msg) => {
                        return (
                          <MessageItem
                            key={msg._id}
                            isOwnMessage={msg.sender?._id === user?._id}
                            isGroupChatMessage={
                              currentChat.current?.isGroupChat
                            }
                            message={msg}
                            deleteChatMessage={deleteChatMessage}
                          />
                        );
                      })}
                    </>
                  )}
                </div>
                {isTyping ? (
                  <div className="absolute bottom-4 left-8 z-10">
                    <Typing label={typingLabel} />
                  </div>
                ) : null}
              </div>
              {attachedFiles.length > 0 ? (
                <div className="grid grid-cols-5 gap-5 p-4 justify-start max-w-fit flex-shrink-0">
                  {attachedFiles.map((file, i) => {
                    const kind = getFileKind(file.name, file.type);
                    const previewUrl = URL.createObjectURL(file);
                    return (
                      <div
                        key={`${file.name}-${file.lastModified}-${i}`}
                        className="group w-32 h-32 relative overflow-hidden border-2 border-ink"
                      >
                        <button
                          onClick={() => {
                            setAttachedFiles(
                              attachedFiles.filter((_, ind) => ind !== i),
                            );
                          }}
                          aria-label="Remove attachment"
                          className="absolute top-1 right-1 z-10 flex h-6 w-6 items-center justify-center border-2 border-ink bg-black text-white"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                        {kind === "image" ? (
                          <img
                            className="h-full w-full object-cover"
                            src={previewUrl}
                            alt="attachment"
                          />
                        ) : kind === "video" ? (
                          <video
                            controls
                            playsInline
                            preload="metadata"
                            src={previewUrl}
                            className="h-full w-full object-contain bg-black"
                          />
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-retro-yellow p-1">
                            <DocumentIcon className="h-8 w-8 text-ink" />
                            <p className="w-full truncate text-center text-[10px] font-bold text-ink">
                              {file.name}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <div className="p-4 flex flex-shrink-0 justify-between items-center w-full gap-2 border-t-4 border-ink bg-cream">
                <input
                  hidden
                  id="attachments"
                  type="file"
                  multiple
                  onChange={(e) => {
                    if (e.target.files) {
                      const incoming = Array.from(e.target.files);
                      setAttachedFiles((prev) => {
                        const remaining = 5 - prev.length;
                        return [...prev, ...incoming.slice(0, remaining)];
                      });
                    }
                    e.target.value = "";
                  }}
                />
                <label
                  htmlFor="attachments"
                  className="neo-sm neo-press block cursor-pointer rounded-sm bg-cream p-4 text-ink hover:bg-retro-yellow"
                >
                  <PaperClipIcon className="w-6 h-6" />
                </label>

                <Input
                  placeholder="Message"
                  value={message}
                  onChange={handleOnMessageChange}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      sendChatMessage();
                    }
                  }}
                />
                <button
                  onClick={sendChatMessage}
                  disabled={!message && attachedFiles.length <= 0}
                  className="neo-sm neo-press rounded-sm bg-retro-yellow p-4 text-ink hover:bg-retro-orange disabled:pointer-events-none disabled:opacity-40"
                >
                  <PaperAirplaneIcon className="w-6 h-6" />
                </button>
              </div>
            </>
          ) : (
            <div className="w-full h-full flex justify-center items-center">
              No chat selected
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ChatPage;
