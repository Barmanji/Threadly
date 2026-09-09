import { Dialog, Transition } from "@headlessui/react";
import {
  PencilIcon,
  TrashIcon,
  UserGroupIcon,
  UserPlusIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import React, { Fragment, useEffect, useState } from "react";
import {
  addParticipantToGroup,
  deleteGroup,
  getAvailableUsers,
  getGroupInfo,
  removeParticipantFromGroup,
  updateGroupName,
} from "../../api";
import { useAuth } from "../../context/AuthContext";
import type { ChatListItemInterface } from "../../interfaces/chat";
import type { UserInterface } from "../../interfaces/user";
import { requestHandler } from "../../utils";
import { toast } from "sonner";
import Button from "../Button";
import Input from "../Input";
import RetroConfirm from "../RetroConfirm";
import Select from "../Select";

const GroupChatDetailsModal: React.FC<{
  open: boolean;
  onClose: () => void;
  chatId: string;
  onGroupDelete: (chatId: string) => void;
}> = ({ open, onClose, chatId, onGroupDelete }) => {
  const { user } = useAuth();
  const [addingParticipant, setAddingParticipant] = useState(false);
  const [renamingGroup, setRenamingGroup] = useState(false);
  const [participantToBeAdded, setParticipantToBeAdded] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [groupDetails, setGroupDetails] =
    useState<ChatListItemInterface | null>(null);
  const [users, setUsers] = useState<UserInterface[]>([]);
  const [participantToRemove, setParticipantToRemove] =
    useState<UserInterface | null>(null);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  const handleGroupNameUpdate = async () => {
    if (!newGroupName) return toast.error("Group name is required");

    requestHandler(
      async () => await updateGroupName(chatId, newGroupName),
      null,
      (res) => {
        const { data } = res;
        setGroupDetails(data);
        setNewGroupName(data.name);
        setRenamingGroup(false);
        toast.success("Group name updated to " + data.name);
      },
      (err) => toast.error(err),
    );
  };

  const getUsers = async () => {
    requestHandler(
      async () => await getAvailableUsers(),
      null,
      (res) => {
        const { data } = res;
        setUsers(data || []);
      },
      (err) => toast.error(err),
    );
  };

  const deleteGroupChat = async () => {
    if (groupDetails?.admin !== user?._id) {
      return toast.error("You are not the admin of the group");
    }

    requestHandler(
      async () => await deleteGroup(chatId),
      null,
      () => {
        onGroupDelete(chatId);
        handleClose();
      },
      (err) => toast.error(err),
    );
  };

  const removeParticipant = async (participantId: string) => {
    requestHandler(
      async () => await removeParticipantFromGroup(chatId, participantId),
      null,
      () => {
        const updatedGroupDetails = {
          ...groupDetails,
          participants:
            (groupDetails?.participants &&
              groupDetails?.participants?.filter(
                (p) => p._id !== participantId,
              )) ||
            [],
        };
        setGroupDetails(updatedGroupDetails as ChatListItemInterface);
        toast.success("Participant removed");
      },
      (err) => toast.error(err),
    );
  };

  const addParticipant = async () => {
    if (!participantToBeAdded)
      return toast.error("Please select a participant to add.");
    requestHandler(
      async () => await addParticipantToGroup(chatId, participantToBeAdded),
      null,
      (res) => {
        const { data } = res;
        const updatedGroupDetails = {
          ...groupDetails,
          participants: data?.participants || [],
        };
        setGroupDetails(updatedGroupDetails as ChatListItemInterface);
        toast.success("Participant added");
      },
      (err) => toast.error(err),
    );
  };

  const fetchGroupInformation = async () => {
    requestHandler(
      async () => await getGroupInfo(chatId),
      null,
      (res) => {
        const { data } = res;
        setGroupDetails(data);
        setNewGroupName(data?.name || "");
      },
      (err) => toast.error(err),
    );
  };

  const handleClose = () => {
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    fetchGroupInformation();
    getUsers();
  }, [open]);

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-40" onClose={handleClose}>
        <Transition.Child
          as={Fragment}
          enter="transform transition ease-in-out duration-500 sm:duration-700"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transform transition ease-in-out duration-500 sm:duration-700"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/50" />
        </Transition.Child>
        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10 sm:pl-16">
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-in-out duration-500 sm:duration-700"
                enterFrom="translate-x-full"
                enterTo="translate-x-0"
                leave="transform transition ease-in-out duration-500 sm:duration-700"
                leaveFrom="translate-x-0"
                leaveTo="translate-x-full"
              >
                <Dialog.Panel className="pointer-events-auto w-screen max-w-2xl">
                  <div className="flex h-full flex-col overflow-y-scroll bg-paper border-l-4 border-ink py-6 shadow-[8px_8px_0_0_var(--color-ink)]">
                    <div className="px-4 sm:px-6">
                      <div className="flex items-start justify-between">
                        <div className="ml-3 flex h-7 items-center">
                          <button
                            type="button"
                            className="relative rounded-sm bg-paper text-ink hover:text-retro-red focus:outline-none"
                            onClick={handleClose}
                          >
                            <span className="absolute -inset-2.5" />
                            <span className="sr-only">Close panel</span>
                            <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="relative mt-6 flex-1 px-4 sm:px-6">
                      <div className="flex flex-col justify-center items-start">
                        <div className="flex pl-16 justify-center items-center relative w-full h-max gap-3">
                          {groupDetails?.participants.slice(0, 3).map((p) => {
                            return (
                              <img
                                className="w-24 h-24 -ml-16 rounded-sm border-[3px] border-ink object-cover"
                                key={p._id}
                                src={p.avatar}
                                alt="avatar"
                              />
                            );
                          })}
                          {groupDetails?.participants &&
                          groupDetails?.participants.length > 3 ? (
                            <p className="text-ink font-extrabold">
                              +{groupDetails?.participants.length - 3}
                            </p>
                          ) : null}
                        </div>
                        <div className="w-full flex flex-col justify-center items-center text-center">
                          {renamingGroup ? (
                            <div className="w-full flex justify-center items-center mt-5 gap-2">
                              <Input
                                placeholder="Enter new group name..."
                                value={newGroupName}
                                onChange={(e) =>
                                  setNewGroupName(e.target.value)
                                }
                              />
                              <Button
                                severity="primary"
                                onClick={handleGroupNameUpdate}
                              >
                                Save
                              </Button>
                              <Button
                                severity="secondary"
                                onClick={() => setRenamingGroup(false)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="w-full inline-flex justify-center items-center text-center mt-5">
                              <h1 className="text-2xl font-extrabold uppercase tracking-wide text-ink truncate-1">
                                {groupDetails?.name}
                              </h1>
                              {groupDetails?.admin === user?._id ? (
                                <button onClick={() => setRenamingGroup(true)}>
                                  <PencilIcon className="w-5 h-5 ml-4 text-ink hover:text-retro-orange" />
                                </button>
                              ) : null}
                            </div>
                          )}

                          <p className="mt-2 text-ink/60 text-sm">
                            Group · {groupDetails?.participants.length}{" "}
                            participants
                          </p>
                        </div>
                        <hr className="border-[3px] border-ink my-5 w-full" />
                        <div className="w-full">
                          <p className="inline-flex items-center font-bold uppercase tracking-wide text-ink">
                            <UserGroupIcon className="h-6 w-6 mr-2" />{" "}
                            {groupDetails?.participants.length} Participants
                          </p>
                          <div className="w-full">
                            {groupDetails?.participants?.map((part) => {
                              return (
                                <React.Fragment key={part._id}>
                                  <div className="flex justify-between items-center w-full py-4">
                                    <div className="flex justify-start items-start gap-3 w-full">
                                      <img
                                        className="h-12 w-12 rounded-sm border-[3px] border-ink object-cover"
                                        src={part.avatar}
                                      />
                                      <div>
                                        <p className="text-ink font-semibold text-sm inline-flex items-center w-full">
                                          {part.username}{" "}
                                          {part._id === groupDetails.admin ? (
                                            <span className="ml-2 text-[10px] px-4 bg-retro-yellow border-2 border-ink rounded-sm text-ink font-bold">
                                              admin
                                            </span>
                                          ) : null}
                                        </p>
                                        <small className="text-ink/60">
                                          {part.email}
                                        </small>
                                      </div>
                                    </div>
                                    {groupDetails.admin === user?._id ? (
                                      <div>
                                        <Button
                                          onClick={() =>
                                            setParticipantToRemove(part)
                                          }
                                          size="small"
                                          severity="danger"
                                        >
                                          Remove
                                        </Button>
                                      </div>
                                    ) : null}
                                  </div>
                                  <hr className="border-[3px] border-ink my-1 w-full" />
                                </React.Fragment>
                              );
                            })}
                            {groupDetails?.admin === user?._id ? (
                              <div className="w-full my-5 flex flex-col justify-center items-center gap-4">
                                {!addingParticipant ? (
                                  <Button
                                    onClick={() => setAddingParticipant(true)}
                                    fullWidth
                                    severity="primary"
                                  >
                                    <UserPlusIcon className="w-5 h-5 mr-1" />{" "}
                                    Add participant
                                  </Button>
                                ) : (
                                  <div className="w-full flex justify-start items-center gap-2">
                                    <Select
                                      placeholder="Select a user to add..."
                                      value={participantToBeAdded}
                                      options={users.map((user) => ({
                                        label: user.username,
                                        value: user._id,
                                      }))}
                                      onChange={({ value }) => {
                                        setParticipantToBeAdded(value);
                                      }}
                                    />
                                    <Button onClick={() => addParticipant()}>
                                      + Add
                                    </Button>
                                    <Button
                                      severity="secondary"
                                      onClick={() => {
                                        setAddingParticipant(false);
                                        setParticipantToBeAdded("");
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                )}
                                <Button
                                  fullWidth
                                  severity="danger"
                                  onClick={() => setConfirmDeleteGroup(true)}
                                >
                                  <TrashIcon className="w-5 h-5 mr-1" /> Delete
                                  group
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>

      <RetroConfirm
        open={!!participantToRemove}
        title="Remove participant"
        message={`Are you sure you want to remove ${participantToRemove?.username} from this group?`}
        confirmText="Remove"
        onCancel={() => setParticipantToRemove(null)}
        onConfirm={() => {
          if (participantToRemove?._id) {
            removeParticipant(participantToRemove._id);
            setParticipantToRemove(null);
          }
        }}
      />

      <RetroConfirm
        open={confirmDeleteGroup}
        title="Delete group"
        message="Are you sure you want to delete this group? This action cannot be undone."
        confirmText="Delete"
        onCancel={() => setConfirmDeleteGroup(false)}
        onConfirm={() => {
          setConfirmDeleteGroup(false);
          deleteGroupChat();
        }}
      />
    </Transition.Root>
  );
};

export default GroupChatDetailsModal;
