import * as anchor from "@project-serum/anchor";

import { MintLayout, TOKEN_PROGRAM_ID, Token } from "@solana/spl-token";

export const CANDY_MACHINE_PROGRAM = new anchor.web3.PublicKey(
  "cndyAnrLdpjq1Ssp1z8xxDsB8dxe7u4HL5Nxi2K5WXZ"
);

const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new anchor.web3.PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

const TOKEN_METADATA_PROGRAM_ID = new anchor.web3.PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export interface CandyMachine {
  id: anchor.web3.PublicKey;
  connection: anchor.web3.Connection;
  program: anchor.Program;
}

interface CandyMachineState {
  candyMachine: CandyMachine;
  itemsAvailable: number;
  itemsRedeemed: number;
  itemsRemaining: number;
  goLiveDate: Date;
}

export const getCandyMachineMints = async (
  connection: anchor.web3.Connection,
  candyMachineId: anchor.web3.PublicKey
): Promise<anchor.web3.PublicKey[]> => {
  let response = await connection.getProgramAccounts(
    new anchor.web3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"),
    {
      dataSlice: { offset: 33, length: 32 },
      filters: [
        {
          memcmp: {
            offset: 326,
            bytes: candyMachineId.toBase58(),
          },
        },
      ],
    }
  );

  return response.map(
    ({ account: { data } }) => new anchor.web3.PublicKey(data)
  );
};

export const getMintedFromCandyMachine = async (
  connection: anchor.web3.Connection,
  candyMachineId: anchor.web3.PublicKey,
  publicKey: anchor.web3.PublicKey
): Promise<anchor.web3.PublicKey[]> => {
  const allMintsCandyMachine = await getCandyMachineMints(
    connection,
    candyMachineId
  );
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
    publicKey,
    {
      programId: TOKEN_PROGRAM_ID,
    }
  );

  const ownerTokens = [];
  for (let index = 0; index < tokenAccounts.value.length; index++) {
    const tokenAccount = tokenAccounts.value[index];
    const tokenAmount = tokenAccount.account.data.parsed.info.tokenAmount;
    const tokenMint = tokenAccount.account.data.parsed.info.mint;

    if (
      tokenAmount.amount === "1" &&
      tokenAmount.decimals === "0" &&
      allMintsCandyMachine.includes(tokenMint)
    )
      ownerTokens.push(tokenMint);
  }

  return ownerTokens;
};

export const awaitTransactionSignatureConfirmation = async (
  txid: anchor.web3.TransactionSignature,
  timeout: number,
  connection: anchor.web3.Connection,
  commitment: anchor.web3.Commitment = "recent",
  queryStatus = false
): Promise<anchor.web3.SignatureStatus | null | void> => {
  let done = false;
  let status: anchor.web3.SignatureStatus | null | void = {
    slot: 0,
    confirmations: 0,
    err: null,
  };
  let subId = 0;
  status = await new Promise(async (resolve, reject) => {
    setTimeout(() => {
      if (done) {
        return;
      }
      done = true;
      console.log("Rejecting for timeout...");
      reject({ timeout: true });
    }, timeout);
    try {
      subId = connection.onSignature(
        txid,
        (result: any, context: any) => {
          done = true;
          status = {
            err: result.err,
            slot: context.slot,
            confirmations: 0,
          };
          if (result.err) {
            console.log("Rejected via websocket", result.err);
            reject(status);
          } else {
            console.log("Resolved via websocket", result);
            resolve(status);
          }
        },
        commitment
      );
    } catch (e) {
      done = true;
      console.error("WS error in setup", txid, e);
    }
    while (!done && queryStatus) {
      // eslint-disable-next-line no-loop-func
      (async () => {
        try {
          const signatureStatuses = await connection.getSignatureStatuses([
            txid,
          ]);
          status = signatureStatuses && signatureStatuses.value[0];
          if (!done) {
            if (!status) {
              console.log("REST null result for", txid, status);
            } else if (status.err) {
              console.log("REST error for", txid, status);
              done = true;
              reject(status.err);
            } else if (!status.confirmations) {
              console.log("REST no confirmations for", txid, status);
            } else {
              console.log("REST confirmation for", txid, status);
              done = true;
              resolve(status);
            }
          }
        } catch (e) {
          if (!done) {
            console.log("REST connection error: txid", txid, e);
          }
        }
      })();
      await sleep(2000);
    }
  });

  //@ts-ignore
  if (connection._signatureSubscriptions[subId]) {
    connection.removeSignatureListener(subId);
  }
  done = true;
  console.log("Returning status", status);
  return status;
};

/* export */ const createAssociatedTokenAccountInstruction = (
  associatedTokenAddress: anchor.web3.PublicKey,
  payer: anchor.web3.PublicKey,
  walletAddress: anchor.web3.PublicKey,
  splTokenMintAddress: anchor.web3.PublicKey
) => {
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: associatedTokenAddress, isSigner: false, isWritable: true },
    { pubkey: walletAddress, isSigner: false, isWritable: false },
    { pubkey: splTokenMintAddress, isSigner: false, isWritable: false },
    {
      pubkey: anchor.web3.SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: anchor.web3.SYSVAR_RENT_PUBKEY,
      isSigner: false,
      isWritable: false,
    },
  ];
  return new anchor.web3.TransactionInstruction({
    keys,
    programId: SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID,
    data: Buffer.from([]),
  });
};

export const getCandyMachineState = async (
  anchorWallet: anchor.Wallet,
  candyMachineId: anchor.web3.PublicKey,
  connection: anchor.web3.Connection
): Promise<CandyMachineState> => {
  const provider = new anchor.Provider(connection, anchorWallet, {
    preflightCommitment: "recent",
  });

  const idl = await anchor.Program.fetchIdl(CANDY_MACHINE_PROGRAM, provider);

  const program = new anchor.Program(idl, CANDY_MACHINE_PROGRAM, provider);
  const candyMachine = {
    id: candyMachineId,
    connection,
    program,
  };

  const state: any = await program.account.candyMachine.fetch(candyMachineId);

  const itemsAvailable = state.data.itemsAvailable.toNumber();
  const itemsRedeemed = state.itemsRedeemed.toNumber();
  const itemsRemaining = itemsAvailable - itemsRedeemed;

  let goLiveDate = state.data.goLiveDate.toNumber();
  goLiveDate = new Date(goLiveDate * 1000);

  console.log({
    itemsAvailable,
    itemsRedeemed,
    itemsRemaining,
    goLiveDate,
  });

  return {
    candyMachine,
    itemsAvailable,
    itemsRedeemed,
    itemsRemaining,
    goLiveDate,
  };
};

const getMasterEdition = async (
  mint: anchor.web3.PublicKey
): Promise<anchor.web3.PublicKey> => {
  return (
    await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
        Buffer.from("edition"),
      ],
      TOKEN_METADATA_PROGRAM_ID
    )
  )[0];
};

const getMetadata = async (
  mint: anchor.web3.PublicKey
): Promise<anchor.web3.PublicKey> => {
  return (
    await anchor.web3.PublicKey.findProgramAddress(
      [
        Buffer.from("metadata"),
        TOKEN_METADATA_PROGRAM_ID.toBuffer(),
        mint.toBuffer(),
      ],
      TOKEN_METADATA_PROGRAM_ID
    )
  )[0];
};

const getTokenWallet = async (
  wallet: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey
) => {
  return (
    await anchor.web3.PublicKey.findProgramAddress(
      [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
    )
  )[0];
};

export const mintMultipleTokens = async (
  candyMachine: any,
  config: anchor.web3.PublicKey,
  payer: anchor.web3.PublicKey,
  treasury: anchor.web3.PublicKey,
  quantity: number = 1
) => {
  const signersMatrix = [];
  const instructionsMatrix = [];

  for (let index = 0; index < quantity; index++) {
    const mint = anchor.web3.Keypair.generate();
    const token = await getTokenWallet(payer, mint.publicKey);
    const { connection } = candyMachine;
    const rent = await connection.getMinimumBalanceForRentExemption(
      MintLayout.span
    );
    const instructions = [
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: payer,
        newAccountPubkey: mint.publicKey,
        space: MintLayout.span,
        lamports: rent,
        programId: TOKEN_PROGRAM_ID,
      }),
      Token.createInitMintInstruction(
        TOKEN_PROGRAM_ID,
        mint.publicKey,
        0,
        payer,
        payer
      ),
      createAssociatedTokenAccountInstruction(
        token,
        payer,
        payer,
        mint.publicKey
      ),
      Token.createMintToInstruction(
        TOKEN_PROGRAM_ID,
        mint.publicKey,
        token,
        payer,
        [],
        1
      ),
    ];
    const masterEdition = await getMasterEdition(mint.publicKey);
    const metadata = await getMetadata(mint.publicKey);

    instructions.push(
      await candyMachine.program.instruction.mintNft({
        accounts: {
          config,
          candyMachine: candyMachine.id,
          payer: payer,
          wallet: treasury,
          mint: mint.publicKey,
          metadata,
          masterEdition,
          mintAuthority: payer,
          updateAuthority: payer,
          tokenMetadataProgram: TOKEN_METADATA_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          clock: anchor.web3.SYSVAR_CLOCK_PUBKEY,
        },
      })
    );
    const signers: anchor.web3.Keypair[] = [mint];

    signersMatrix.push(signers);
    instructionsMatrix.push(instructions);
  }

  return await sendTransactions(
    candyMachine.program.provider.connection,
    candyMachine.program.provider.wallet,
    instructionsMatrix,
    signersMatrix
  );
};

export const sendTransactions = async (
  connection: anchor.web3.Connection,
  wallet: any,
  instructionSet: anchor.web3.TransactionInstruction[][],
  signersSet: anchor.web3.Keypair[][]
): Promise<string[]> => {
  if (!wallet.publicKey) throw new Error();

  const unsignedTxns: anchor.web3.Transaction[] = [];
  const block = await connection.getRecentBlockhash("singleGossip");

  for (let i = 0; i < instructionSet.length; i++) {
    const instructions = instructionSet[i];
    const signers = signersSet[i];

    if (instructions.length === 0) {
      continue;
    }

    let transaction = new anchor.web3.Transaction();
    instructions.forEach((instruction) => transaction.add(instruction));
    transaction.recentBlockhash = block.blockhash;
    transaction.setSigners(
      // fee payed by the wallet owner
      wallet.publicKey,
      ...signers.map((s) => s.publicKey)
    );

    if (signers.length > 0) {
      transaction.partialSign(...signers);
    }

    unsignedTxns.push(transaction);
  }

  const signedTxns = await wallet.signAllTransactions(unsignedTxns);

  const pendingTxns: Promise<{ txid: string; slot: number }>[] = [];

  console.log(
    "Signed txns length",
    signedTxns.length,
    "vs handed in length",
    instructionSet.length
  );

  const txIds = [];
  for (let i = 0; i < signedTxns.length; i++) {
    const signedTxnPromise = sendSignedTransaction({
      connection,
      signedTransaction: signedTxns[i],
    });

    try {
      const { txid } = await signedTxnPromise;
      txIds.push(txid);
    } catch (error) {
      console.error(error);
    }

    pendingTxns.push(signedTxnPromise);
  }

  await Promise.all(pendingTxns);

  return txIds;
};

export async function sendSignedTransaction({
  signedTransaction,
  connection,
  timeout = 60000,
}: {
  signedTransaction: anchor.web3.Transaction;
  connection: anchor.web3.Connection;
  sendingMessage?: string;
  sentMessage?: string;
  successMessage?: string;
  timeout?: number;
}): Promise<{ txid: string; slot: number }> {
  const rawTransaction = signedTransaction.serialize();
  const startTime = getUnixTs();
  let slot = 0;
  const txid: anchor.web3.TransactionSignature =
    await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
    });

  console.log("Started awaiting confirmation for", txid);

  let done = false;
  (async () => {
    while (!done && getUnixTs() - startTime < timeout) {
      connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
      });
      await sleep(500);
    }
  })();
  try {
    const confirmation = await awaitTransactionSignatureConfirmation(
      txid,
      timeout,
      connection,
      "recent",
      true
    );

    if (!confirmation)
      throw new Error("Timed out awaiting confirmation on transaction");

    if (confirmation.err) {
      console.error(confirmation.err);
      throw new Error("Transaction failed: Custom instruction error");
    }

    slot = confirmation?.slot || 0;
  } catch (err: any) {
    console.error("Timeout Error caught", err);
    if (err.timeout) {
      throw new Error("Timed out awaiting confirmation on transaction");
    }
    throw err;
  } finally {
    done = true;
  }

  console.log("Latency", txid, getUnixTs() - startTime);
  return { txid, slot };
}

export const getUnixTs = () => {
  return new Date().getTime() / 1000;
};

export const shortenAddress = (address: string, chars = 4): string => {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
};

export const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
