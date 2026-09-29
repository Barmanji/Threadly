import mongoose from "mongoose";

/**
 * Pipeline stages that shape a stored message into the shape the client
 * renders: the sender is resolved to a user, and each reaction is resolved to
 * the user who made it.
 *
 * Shared between the message controller (fetch, send, react) and the
 * server-side call logger so a call message arrives over the socket looking
 * exactly like a message that was fetched over HTTP. When this lived inside
 * the controller, the call logger would have had to duplicate it — and the two
 * copies would have drifted the first time the shape changed.
 *
 * @returns {mongoose.PipelineStage[]}
 */
export const chatMessageCommonAggregation = (): mongoose.PipelineStage[] => {
  return [
    {
      $lookup: {
        from: "users",
        foreignField: "_id",
        localField: "sender",
        as: "sender",
        pipeline: [
          {
            $project: {
              _id: 1,
              username: 1,
              avatar: 1,
              email: 1,
            },
          },
        ],
      },
    },
    {
      $addFields: {
        sender: { $first: "$sender" },
      },
    },
    // Resolve the reactor on each reaction so the client can render avatars
    // and "who reacted" without a second round trip. Only the fields the UI
    // needs are projected — an email address has no business riding along
    // inside a reaction chip.
    //
    // The original array has to be stashed first: a `$lookup` on an array
    // `localField` *replaces* it with the resolved users, dropping the emoji
    // that was stored alongside each id.
    {
      $set: { storedReactions: { $ifNull: ["$reactions", []] } },
    },
    {
      $lookup: {
        from: "users",
        foreignField: "_id",
        localField: "storedReactions.user",
        as: "resolvedReactors",
        pipeline: [{ $project: { _id: 1, username: 1, avatar: 1 } }],
      },
    },
    {
      $set: {
        reactions: {
          $map: {
            input: "$storedReactions",
            as: "reaction",
            in: {
              $mergeObjects: [
                "$$reaction",
                // Pair by id, not by position. `$lookup` silently omits users
                // that no longer exist, so positional pairing would shift
                // every subsequent emoji onto the wrong person. `$first` of
                // an empty match is null and `$mergeObjects` ignores it, so a
                // reaction from a deleted user keeps just its raw id.
                {
                  $first: {
                    $filter: {
                      input: { $ifNull: ["$resolvedReactors", []] },
                      as: "reactor",
                      cond: { $eq: ["$$reactor._id", "$$reaction.user"] },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    // Drop the scratch fields so they never reach the client.
    { $unset: ["storedReactions", "resolvedReactors"] },
    // `endedBy` on a call log carries a user id; resolve it the same way so
    // the bubble can name who dropped the call. Guarded with `$type` so a
    // text message — which has no `call` at all — doesn't gain a phantom
    // `call: { endedBy: null }` from `$set` creating the missing parent path.
    {
      $lookup: {
        from: "users",
        foreignField: "_id",
        localField: "call.endedBy",
        as: "callEndedBy",
        pipeline: [{ $project: { _id: 1, username: 1, avatar: 1 } }],
      },
    },
    {
      $set: {
        call: {
          $cond: [
            { $eq: [{ $type: "$call" }, "object"] },
            {
              $mergeObjects: [
                "$call",
                {
                  endedBy: {
                    $ifNull: [{ $first: "$callEndedBy" }, "$call.endedBy"],
                  },
                },
              ],
            },
            "$$REMOVE",
          ],
        },
      },
    },
    { $unset: "callEndedBy" },
  ];
};
