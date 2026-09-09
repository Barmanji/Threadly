import { LockClosedIcon } from "@heroicons/react/20/solid";
import { useState } from "react";
import Button from "../components/Button";
import Input from "../components/Input";
import { useAuth } from "../context/AuthContext";

const Register = () => {
    const [data, setData] = useState<{
        email: string;
        username: string;
        password: string;
        avatar: File | null;
    }>({
        email: "",
        username: "",
        password: "",
        avatar: null,
    });

    // Access the register function from the authentication context
    const { register } = useAuth();

    // Handle data change for input fields
    const handleDataChange =
        (name: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
            const value =
                e.target.type === "file"
                    ? e.target.files?.[0] || null
                    : e.target.value;
            setData({
                ...data,
                [name]: value,
            });
        };

    // Handle user registration
    const handleRegister = async () => await register(data);

    return (
        // Register form UI
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-cream">
            <h1 className="neo rotate-[2deg] bg-retro-yellow px-6 py-2 text-3xl font-extrabold uppercase tracking-tight text-ink">
                Threadly
            </h1>
            <div className="neo my-10 flex w-1/2 max-w-5xl flex-col items-center justify-center gap-5 bg-retro-orange p-8">
                <h1 className="neo-sm flex flex-col items-center bg-cream px-6 py-2 text-2xl">
                    <LockClosedIcon className="mb-2 h-8 w-8 text-retro-orange" /> Register
                </h1>
                <Input
                    placeholder="Enter the email..."
                    type="email"
                    value={data.email}
                    onChange={handleDataChange("email")}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            handleRegister();
                        }
                    }}
                />
                <Input
                    placeholder="Enter the username..."
                    value={data.username}
                    onChange={handleDataChange("username")}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            handleRegister();
                        }
                    }}
                />
                <Input
                    placeholder="Enter the password..."
                    type="password"
                    value={data.password}
                    onChange={handleDataChange("password")}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            handleRegister();
                        }
                    }}
                />
                <Input
                    placeholder="Upload avatar..."
                    type="file"
                    onChange={handleDataChange("avatar")}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            handleRegister();
                        }
                    }}
                />

                <Button
                    fullWidth
                    disabled={Object.values(data).some((val) => !val)}
                    onClick={handleRegister}
                >
                    Register
                </Button>
                <small className="font-bold text-ink">
                    Already have an account?{" "}
                    <a
                        className="neo-sm bg-retro-yellow px-1 font-extrabold uppercase tracking-wide hover:bg-cream"
                        href="/login"
                    >
                        Login
                    </a>
                </small>
            </div>
        </div>
    );
};

export default Register;