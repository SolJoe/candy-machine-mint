import { useEffect, useState } from "react";
import styled from "styled-components";
import Countdown from "react-countdown";
import { Button, CircularProgress, Snackbar } from "@material-ui/core";
import Alert from "@material-ui/lab/Alert";

import * as anchor from "@project-serum/anchor";

import { LAMPORTS_PER_SOL } from "@solana/web3.js";

import { useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletDialogButton } from "@solana/wallet-adapter-material-ui";

import {
  CandyMachine,
  awaitTransactionSignatureConfirmation,
  getCandyMachineState,
  mintMultipleTokens,
  shortenAddress,
} from "./candy-machine";

import access from "./access.json";

const ConnectButton = styled(WalletDialogButton)``;

const CounterText = styled.span``; // add your styles here

const MintContainer = styled.div``; // add your styles here

const MintButton = styled(Button)``; // add your styles here

function parseDate(dateString: string | null): Date | null {
  if (!dateString) return null;

  let date = new Date(dateString);
  if (isNaN(date.getTime()))
    throw new Error(`Could not parse as date: ${dateString}`);
  return date;
}

const ACCESS_CONFIG: any = [];
function checkAccess(publicKey: anchor.web3.PublicKey) {
  if (!ACCESS_CONFIG.length) {
    for (let { start, end, wallets } of access)
      ACCESS_CONFIG.push({
        start: parseDate(start),
        end: end ? parseDate(end) : null,
        wallets: wallets ? new Set(wallets) : null,
      });
  }

  let now = new Date();
  for (let { start, end, wallets } of ACCESS_CONFIG)
    if (
      start.getTime() < now.getTime() &&
      (!end || now.getTime() < end.getTime()) &&
      (!wallets || wallets.has(publicKey.toBase58()))
    )
      return {
        hasAccess: true,
        error: "",
      };

  return {
    hasAccess: false,
    error: "Not authorized",
  };
}

export interface HomeProps {
  candyMachineId: anchor.web3.PublicKey;
  config: anchor.web3.PublicKey;
  connection: anchor.web3.Connection;
  startDate: number;
  treasury: anchor.web3.PublicKey;
  txTimeout: number;
}

const Home = (props: HomeProps) => {
  const [balance, setBalance] = useState<number>();
  const [isActive, setIsActive] = useState(false); // true when countdown completes
  const [isSoldOut, setIsSoldOut] = useState(false); // true when items remaining is zero
  const [isMinting, setIsMinting] = useState(false); // true when user got to press MINT

  const [itemsAvailable, setItemsAvailable] = useState(0);
  const [itemsRedeemed, setItemsRedeemed] = useState(0);
  const [itemsRemaining, setItemsRemaining] = useState(0);
  const [mintQuantity, setMintQuantity] = useState(1);

  const [alertState, setAlertState] = useState<AlertState>({
    open: false,
    message: "",
    severity: undefined,
  });

  const [startDate, setStartDate] = useState(new Date(props.startDate));

  const wallet = useAnchorWallet();
  const [candyMachine, setCandyMachine] = useState<CandyMachine>();

  const refreshCandyMachineState = () => {
    (async () => {
      if (!wallet) return;

      const {
        candyMachine,
        goLiveDate,
        itemsAvailable,
        itemsRemaining,
        itemsRedeemed,
      } = await getCandyMachineState(
        wallet as anchor.Wallet,
        props.candyMachineId,
        props.connection
      );

      setItemsAvailable(itemsAvailable);
      setItemsRemaining(itemsRemaining);
      setItemsRedeemed(itemsRedeemed);

      setIsSoldOut(itemsRemaining === 0);
      setStartDate(goLiveDate);
      setCandyMachine(candyMachine);
    })();
  };

  const onMint = async () => {
    if (!wallet) return;

    let access = checkAccess(wallet.publicKey);
    if (!access.hasAccess) {
      setAlertState({
        open: true,
        message: access.error,
        severity: "error",
      });
      return;
    }

    try {
      setIsMinting(true);
      if (wallet && candyMachine?.program) {
        const mintTxIds = await mintMultipleTokens(
          candyMachine,
          props.config,
          wallet.publicKey,
          props.treasury,
          mintQuantity
        );

        const statuses = await Promise.allSettled(
          mintTxIds.map((tx) =>
            awaitTransactionSignatureConfirmation(
              tx,
              props.txTimeout,
              props.connection,
              "processed",
              false
            )
          )
        );

        let success = statuses.filter((e) => e.status === "fulfilled").length;
        let failure = statuses.length - success;

        if (success > 0) {
          setAlertState({
            open: true,
            message: `Congratulations! Minted ${success} tokens successfully!`,
            severity: "success",
          });
        }
        if (failure > 0) {
          setAlertState({
            open: true,
            message: `Failed to mint ${failure} tokens! Please try again!`,
            severity: "error",
          });
        }
      }
    } catch (error: any) {
      // TODO: blech:
      console.log(error);
      let message = error.msg || "Minting failed! Please try again!";
      let code = error?.err?.InstructionError[1]?.Custom;
      console.log({code})
      if (code === 0x137) message = `SOLD OUT!`;
      else if (code === 0x135)
        message = `Insufficient funds to mint. Please fund your wallet.`;
      else if (code === 311) {
        message = `SOLD OUT!`;
        setIsSoldOut(true);
      } else if (code === 312) {
        message = `Minting period hasn't started yet.`;
      }

      setAlertState({
        open: true,
        message,
        severity: "error",
      });
    } finally {
      if (wallet) {
        const balance = await props.connection.getBalance(wallet.publicKey);
        setBalance(balance / LAMPORTS_PER_SOL);
      }
      setIsMinting(false);
      refreshCandyMachineState();
    }
  };

  useEffect(() => {
    (async () => {
      if (wallet) {
        const balance = await props.connection.getBalance(wallet.publicKey);
        setBalance(balance / LAMPORTS_PER_SOL);
      }
    })();
  }, [wallet, props.connection]);

  useEffect(refreshCandyMachineState, [
    wallet,
    props.candyMachineId,
    props.connection,
  ]);

  return (
    <main>
      {wallet && (
        <p>Wallet {shortenAddress(wallet.publicKey.toBase58() || "")}</p>
      )}

      {wallet && <p>Balance: {(balance || 0).toLocaleString()} SOL</p>}

      {wallet && <p>Total Available: {itemsAvailable}</p>}

      {wallet && <p>Redeemed: {itemsRedeemed}</p>}

      {wallet && <p>Remaining: {itemsRemaining}</p>}

      <MintContainer>
        {!wallet && (
          <div style={{ marginBottom: "2rem" }}>
            <img
              style={{ width: "24rem", height: "24rem", borderRadius: "1.5rem" }}
              src="./slideshow.gif"
              alt="SolGhosts slideshow gif"
            />
          </div>
        )}
        {!wallet ? (
          <ConnectButton id="connect-button">Connect Wallet</ConnectButton>
        ) : (
          <div>
            {isSoldOut ? (
              "SOLD OUT"
            ) : isActive ? (
              isMinting ? (
                <CircularProgress />
              ) : (
                <div>
                  <button
                    disabled={mintQuantity <= 1}
                    onClick={() => setMintQuantity(mintQuantity - 1)}
                    className="input-control-button"
                  >
                    -
                  </button>
                  <MintButton
                    id="mint-button"
                    disabled={isSoldOut || isMinting || !isActive}
                    onClick={onMint}
                    variant="contained"
                  >
                    Mint {mintQuantity} SolGhost
                  </MintButton>
                  <button
                    onClick={() => setMintQuantity(mintQuantity + 1)}
                    className="input-control-button"
                  >
                    +
                  </button>
                </div>
              )
            ) : (
              <Countdown
                date={new Date(startDate)}
                onMount={({ completed }) => completed && setIsActive(true)}
                onComplete={() => setIsActive(true)}
                renderer={renderCounter}
              />
            )}
          </div>
        )}
      </MintContainer>

      <Snackbar
        open={alertState.open}
        autoHideDuration={6000}
        onClose={() => setAlertState({ ...alertState, open: false })}
      >
        <Alert
          onClose={() => setAlertState({ ...alertState, open: false })}
          severity={alertState.severity}
        >
          {alertState.message}
        </Alert>
      </Snackbar>
    </main>
  );
};

interface AlertState {
  open: boolean;
  message: string;
  severity: "success" | "info" | "warning" | "error" | undefined;
}

const renderCounter = ({ days, hours, minutes, seconds, completed }: any) => {
  return (
    <CounterText>
      {hours + (days || 0) * 24} hours, {minutes} minutes, {seconds} seconds
    </CounterText>
  );
};

export default Home;
