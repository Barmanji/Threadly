import { LockClosedIcon } from "@heroicons/react/20/solid";
import { useState } from "react";
import Button from "../components/Button";
import Input from "../components/Input";
import { useAuth } from "../context/AuthContext";

// Component for the Login page
const Login = () => {
    // State to manage input data (username and password)
    const [data, setData] = useState({
        username: "",
        password: "",
    });

    const { login } = useAuth();

    const handleDataChange =
        (name: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
            setData({
                ...data,
                [name]: e.target.value,
            });
        };

    const handleLogin = async () => await login(data);

    return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-cream">
            <h1 className="neo rotate-[-2deg] bg-retro-yellow px-6 py-2 text-3xl font-extrabold uppercase tracking-tight text-ink">
                Threadly
            </h1>
            <div className="neo my-10 flex w-1/2 max-w-5xl flex-col items-center justify-center gap-5 bg-retro-orange p-8">
                <h1 className="neo-sm flex flex-col items-center bg-cream px-6 py-2 text-2xl">
                    <LockClosedIcon className="mb-2 h-8 w-8 text-retro-orange" /> Login
                </h1>
                <Input
                    placeholder="Enter the username..."
                    value={data.username}
                    onChange={handleDataChange("username")}
                />
                <Input
                    placeholder="Enter the password..."
                    type="password"
                    value={data.password}
                    onChange={handleDataChange("password")}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            handleLogin();
                        }
                    }}
                />
                <Button
                    disabled={Object.values(data).some((val) => !val)}
                    fullWidth
                    onClick={handleLogin}
                >
                    Login
                </Button>
                <small className="font-bold text-ink">
                    Don&apos;t have an account?{" "}
                    <a
                        className="neo-sm bg-retro-yellow px-1 font-extrabold uppercase tracking-wide hover:bg-cream"
                        href="/register"
                    >
                        Register
                    </a>
                </small>
            </div>
        </div>
    );
};

export default Login;